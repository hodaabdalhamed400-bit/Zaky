import { z } from "zod";
import { Prisma, type PaymentMethod, type PurchasePaymentStatus, type PurchaseStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, branchWhere, requirePermission } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh } from "@/lib/dates";
import { money } from "@/lib/money";
import { decimalString, optionalText, parseInput } from "@/lib/validation";
import { uploadDocument, validateUploadFile } from "./documents.service";
import { notify, resolve } from "./notifications.service";
import { PAYMENT_METHOD_LABELS } from "./payments.service";

/**
 * فواتير الشراء (مصروفات الفروع):
 * - مدير الفرع (أو المحاسب) يضيف الفاتورة بصورتها، وتبقى «بانتظار المراجعة».
 * - المحاسب يعتمدها أو يرجعها بسبب؛ المرجَعة تُعدَّل وتعود للمراجعة.
 * - الإجمالي شامل الضريبة كما في فاتورة المورد، والضريبة تُكتب كما في الفاتورة (يُقترح 15%).
 * - الفاتورة المعتمدة لا تُعدَّل (قيد في قاعدة البيانات)؛ يُسجَّل فقط دفعها للمورد.
 */

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  PENDING_REVIEW: "بانتظار المراجعة",
  APPROVED: "معتمدة",
  REJECTED: "مُرجَعة للتعديل",
};
export const PURCHASE_STATUS_COLOR = { PENDING_REVIEW: "amber", APPROVED: "green", REJECTED: "red" } as const;
export const PURCHASE_PAYMENT_LABELS: Record<PurchasePaymentStatus, string> = { UNPAID: "غير مدفوعة", PAID: "مدفوعة" };
export const PURCHASE_PAYMENT_COLOR = { UNPAID: "gray", PAID: "blue" } as const;

const VAT_RATE = new Prisma.Decimal("0.15");

/** الضريبة المقترحة من إجمالي شامل الضريبة: الإجمالي × 15 ÷ 115 */
export function suggestVat(total: Prisma.Decimal.Value) {
  return money(new Prisma.Decimal(total).times(VAT_RATE).dividedBy(VAT_RATE.plus(1)));
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "اختر تاريخًا صحيحًا");
const vatNo = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s/g, "") : null))
  .refine((v) => v === null || /^3\d{13}3$/.test(v), "الرقم الضريبي للمورد 15 رقمًا يبدأ وينتهي بالرقم 3");

const fieldsSchema = z
  .object({
    categoryId: z.string().uuid("اختر التصنيف"),
    supplierName: z.string().trim().min(2, "اكتب اسم المورد").max(200),
    supplierVatNo: vatNo,
    invoiceNo: z.string().trim().min(1, "اكتب رقم فاتورة المورد").max(60),
    invoiceDate: ymd,
    totalAmount: decimalString("الإجمالي شامل الضريبة"),
    vatAmount: decimalString("مبلغ الضريبة", { allowZero: true }),
    description: optionalText(1000),
  })
  .refine((v) => new Prisma.Decimal(v.vatAmount).lte(v.totalAmount), { message: "مبلغ الضريبة لا يمكن أن يتجاوز الإجمالي", path: ["vatAmount"] })
  .refine((v) => v.invoiceDate <= todayInRiyadh(), { message: "تاريخ الفاتورة لا يمكن أن يكون في المستقبل", path: ["invoiceDate"] });

const createSchema = z.object({ branchId: z.string().uuid("اختر الفرع") }).and(fieldsSchema);

type Tx = Prisma.TransactionClient;

async function nextRefNo(tx: Tx, branchCode: string, year: string) {
  const key = `PURCHASE-${branchCode}-${year}`;
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (key, last_value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING last_value`;
  return `PI-${branchCode}-${year}-${String(rows[0]!.last_value).padStart(5, "0")}`;
}

function mapDbErrors(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("purchase_invoices_no_duplicate")) throw new AppError("DUPLICATE", "هذه الفاتورة مسجلة مسبقًا (نفس المورد ونفس رقم الفاتورة)");
  if (msg.includes("ZAKI_IMMUTABLE")) throw new AppError("STATE", "فاتورة الشراء المعتمدة لا تُعدَّل");
  throw e;
}

async function assertCategory(db: Db | Tx, id: string) {
  const c = await db.expenseCategory.findUnique({ where: { id } });
  if (!c || !c.isActive) throw new AppError("VALIDATION", "التصنيف غير متاح");
  return c;
}

async function duplicateCheck(db: Db, supplierName: string, invoiceNo: string, excludeId?: string) {
  const dup = await db.purchaseInvoice.findFirst({
    where: {
      supplierName: { equals: supplierName.trim(), mode: "insensitive" },
      invoiceNo: { equals: invoiceNo.trim(), mode: "insensitive" },
      status: { not: "REJECTED" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { refNo: true },
  });
  if (dup) throw new AppError("DUPLICATE", `هذه الفاتورة مسجلة مسبقًا برقم ${dup.refNo} (نفس المورد ونفس رقم الفاتورة)`);
}

const amounts = (total: string, vat: string) => {
  const t = money(total);
  const v = money(vat);
  return { totalAmount: t, vatAmount: v, netAmount: t.minus(v) };
};

async function notifyApprovers(tx: Tx, p: { id: string; refNo: string; branchId: string; supplierName: string; totalAmount: Prisma.Decimal }, actorId: string) {
  await notify(tx, {
    type: "PURCHASE_PENDING_REVIEW",
    title: `فاتورة شراء بانتظار المراجعة: ${p.totalAmount.toFixed(2)} ر.س`,
    body: `${p.supplierName} — ${p.refNo}`,
    link: `/purchases/${p.id}`,
    entityType: "purchase_invoice",
    entityId: p.id,
    dedupeKey: `PURCHASE_PENDING_REVIEW:${p.id}:${Date.now()}`,
    branchId: p.branchId,
    permission: "purchases.approve",
    excludeUserId: actorId,
  });
}

type UploadFile = { name: string; size: number; bytes: Uint8Array } | null;

/** إضافة فاتورة شراء مع صورتها (إلزامية). يعيد الفاتورة، وخطأ رفع المرفق إن حدث بعد الحفظ. */
export async function createPurchase(db: Db, actor: Actor, raw: unknown, file: UploadFile, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.create");
  requirePermission(actor, "documents.upload");
  const input = parseInput(createSchema, raw);
  assertBranchAccess(actor, input.branchId);
  await assertCategory(db, input.categoryId);
  validateUploadFile(file); // قبل الحفظ: لا تُنشأ فاتورة بمرفق غير صالح
  await duplicateCheck(db, input.supplierName, input.invoiceNo);
  const branch = await db.branch.findUnique({ where: { id: input.branchId }, select: { code: true } });
  if (!branch) throw new NotFoundError("الفرع غير موجود");

  let invoice;
  try {
    invoice = await db.$transaction(async (tx) => {
      const refNo = await nextRefNo(tx, branch.code, input.invoiceDate.slice(0, 4));
      const p = await tx.purchaseInvoice.create({
        data: {
          refNo,
          branchId: input.branchId,
          categoryId: input.categoryId,
          supplierName: input.supplierName,
          supplierVatNo: input.supplierVatNo,
          invoiceNo: input.invoiceNo,
          invoiceDate: dateOnly(input.invoiceDate),
          description: input.description,
          ...amounts(input.totalAmount, input.vatAmount),
          createdById: actor.id,
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "purchase.create",
        entityType: "purchase_invoice",
        entityId: p.id,
        branchId: p.branchId,
        after: { refNo, supplier: p.supplierName, invoiceNo: p.invoiceNo, total: p.totalAmount.toFixed(2), vat: p.vatAmount.toFixed(2) },
        meta,
      });
      await notifyApprovers(tx, p, actor.id);
      return p;
    });
  } catch (e) {
    mapDbErrors(e);
  }

  let uploadError: string | null = null;
  try {
    await uploadDocument(db, actor, { file, category: "PURCHASE_INVOICE", owner: { purchaseInvoiceId: invoice.id } }, meta);
  } catch (e) {
    uploadError = e instanceof AppError ? e.message : "تعذر رفع صورة الفاتورة";
  }
  return { invoice, uploadError };
}

async function loadPurchase(db: Db | Tx, actor: Actor, id: string) {
  const p = await db.purchaseInvoice.findUnique({ where: { id }, include: { branch: { select: { nameAr: true, code: true } }, category: { select: { nameAr: true } } } });
  if (!p) throw new NotFoundError("الفاتورة غير موجودة");
  assertBranchAccess(actor, p.branchId);
  return p;
}

/** تعديل فاتورة لم تُعتمد بعد؛ المرجَعة تعود للمراجعة بعد التعديل. الفرع لا يتغير. */
export async function updatePurchase(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.create");
  const input = parseInput(fieldsSchema, raw);
  const existing = await loadPurchase(db, actor, id);
  if (existing.status === "APPROVED") throw new AppError("STATE", "فاتورة الشراء المعتمدة لا تُعدَّل");
  if (input.categoryId !== existing.categoryId) await assertCategory(db, input.categoryId);
  await duplicateCheck(db, input.supplierName, input.invoiceNo, id);
  try {
    return await db.$transaction(async (tx) => {
      const done = await tx.purchaseInvoice.updateMany({
        where: { id, status: { in: ["PENDING_REVIEW", "REJECTED"] } },
        data: {
          categoryId: input.categoryId,
          supplierName: input.supplierName,
          supplierVatNo: input.supplierVatNo,
          invoiceNo: input.invoiceNo,
          invoiceDate: dateOnly(input.invoiceDate),
          description: input.description,
          ...amounts(input.totalAmount, input.vatAmount),
          status: "PENDING_REVIEW",
          rejectedById: null,
          rejectedAt: null,
          rejectionReason: null,
        },
      });
      if (done.count !== 1) throw new AppError("STATE", "تم اعتماد الفاتورة بالفعل");
      const p = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id } });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "purchase.update",
        entityType: "purchase_invoice",
        entityId: id,
        branchId: p.branchId,
        before: { status: existing.status, supplier: existing.supplierName, invoiceNo: existing.invoiceNo, total: existing.totalAmount.toFixed(2), vat: existing.vatAmount.toFixed(2) },
        after: { status: p.status, supplier: p.supplierName, invoiceNo: p.invoiceNo, total: p.totalAmount.toFixed(2), vat: p.vatAmount.toFixed(2) },
        meta,
      });
      if (existing.status === "REJECTED") await notifyApprovers(tx, p, actor.id);
      return p;
    });
  } catch (e) {
    mapDbErrors(e);
  }
}

export async function approvePurchase(db: Db, actor: Actor, id: string, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.approve");
  const p = await loadPurchase(db, actor, id);
  if (p.status !== "PENDING_REVIEW") throw new AppError("STATE", "الفاتورة ليست بانتظار المراجعة");
  const attachments = await db.document.count({ where: { purchaseInvoiceId: id, deletedAt: null } });
  if (attachments === 0) throw new AppError("VALIDATION", "لا يمكن الاعتماد بدون صورة الفاتورة — ارفعها أولًا");
  return db.$transaction(async (tx) => {
    const done = await tx.purchaseInvoice.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date() } });
    if (done.count !== 1) throw new AppError("STATE", "تمت مراجعة الفاتورة بالفعل");
    await writeAudit(tx, { actorId: actor.id, action: "purchase.approve", entityType: "purchase_invoice", entityId: id, branchId: p.branchId, after: { refNo: p.refNo, total: p.totalAmount.toFixed(2) }, meta });
    await resolve(tx, ["PURCHASE_PENDING_REVIEW"], [id]);
    return tx.purchaseInvoice.findUniqueOrThrow({ where: { id } });
  });
}

export async function rejectPurchase(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.approve");
  const r = parseInput(z.string().trim().min(3, "اذكر سبب الإرجاع").max(1000), reason);
  const p = await loadPurchase(db, actor, id);
  if (p.status !== "PENDING_REVIEW") throw new AppError("STATE", "الفاتورة ليست بانتظار المراجعة");
  return db.$transaction(async (tx) => {
    const done = await tx.purchaseInvoice.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { status: "REJECTED", rejectedById: actor.id, rejectedAt: new Date(), rejectionReason: r } });
    if (done.count !== 1) throw new AppError("STATE", "تمت مراجعة الفاتورة بالفعل");
    await writeAudit(tx, { actorId: actor.id, action: "purchase.reject", entityType: "purchase_invoice", entityId: id, branchId: p.branchId, after: { reason: r }, meta });
    await resolve(tx, ["PURCHASE_PENDING_REVIEW"], [id]);
    return tx.purchaseInvoice.findUniqueOrThrow({ where: { id } });
  });
}

const paidSchema = z.object({
  method: z.enum(Object.keys(PAYMENT_METHOD_LABELS) as [PaymentMethod, ...PaymentMethod[]], { message: "اختر وسيلة الدفع" }),
  paidOn: ymd.refine((v) => v <= todayInRiyadh(), "تاريخ الدفع لا يمكن أن يكون في المستقبل"),
});

/** تسجيل دفع الفاتورة للمورد (بعد الاعتماد فقط) */
export async function markPurchasePaid(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.approve");
  const input = parseInput(paidSchema, raw);
  const p = await loadPurchase(db, actor, id);
  if (p.status !== "APPROVED") throw new AppError("STATE", "اعتمد الفاتورة أولًا قبل تسجيل دفعها");
  if (p.paymentStatus === "PAID") throw new AppError("STATE", "الفاتورة مسجلة كمدفوعة بالفعل");
  return db.$transaction(async (tx) => {
    const done = await tx.purchaseInvoice.updateMany({ where: { id, status: "APPROVED", paymentStatus: "UNPAID" }, data: { paymentStatus: "PAID", paymentMethod: input.method, paidOn: dateOnly(input.paidOn) } });
    if (done.count !== 1) throw new AppError("STATE", "تم تحديث الفاتورة بالفعل");
    await writeAudit(tx, { actorId: actor.id, action: "purchase.mark_paid", entityType: "purchase_invoice", entityId: id, branchId: p.branchId, after: { method: input.method, paidOn: input.paidOn }, meta });
    return tx.purchaseInvoice.findUniqueOrThrow({ where: { id } });
  });
}

/** إلغاء تسجيل الدفع (تصحيح خطأ) مع سبب مسجل في التدقيق */
export async function markPurchaseUnpaid(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.approve");
  const r = parseInput(z.string().trim().min(5, "اذكر سبب إلغاء الدفع بوضوح").max(1000), reason);
  const p = await loadPurchase(db, actor, id);
  if (p.paymentStatus !== "PAID") throw new AppError("STATE", "الفاتورة غير مسجلة كمدفوعة");
  return db.$transaction(async (tx) => {
    await tx.purchaseInvoice.update({ where: { id }, data: { paymentStatus: "UNPAID", paymentMethod: null, paidOn: null } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "purchase.mark_unpaid",
      entityType: "purchase_invoice",
      entityId: id,
      branchId: p.branchId,
      before: { method: p.paymentMethod, paidOn: p.paidOn?.toISOString().slice(0, 10) },
      after: { reason: r },
      meta,
    });
    return tx.purchaseInvoice.findUniqueOrThrow({ where: { id } });
  });
}

// ───── القوائم ─────

export const purchaseFiltersSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED"]).optional().catch(undefined),
  pay: z.enum(["UNPAID", "PAID"]).optional().catch(undefined),
  branchId: z.string().uuid().optional().catch(undefined),
  categoryId: z.string().uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().catch(undefined),
});
export const PURCHASES_PAGE_SIZE = 30;

export async function listPurchases(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "purchases.view");
  const f = purchaseFiltersSchema.parse(raw ?? {});
  if (f.branchId) assertBranchAccess(actor, f.branchId);
  const and: Prisma.PurchaseInvoiceWhereInput[] = [branchWhere(actor, "branchId")];
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.categoryId) and.push({ categoryId: f.categoryId });
  if (f.status) and.push({ status: f.status });
  if (f.pay) and.push({ paymentStatus: f.pay });
  if (f.from) and.push({ invoiceDate: { gte: dateOnly(f.from) } });
  if (f.to) and.push({ invoiceDate: { lte: dateOnly(f.to) } });
  if (f.q)
    and.push({
      OR: [
        { refNo: { contains: f.q, mode: "insensitive" } },
        { invoiceNo: { contains: f.q, mode: "insensitive" } },
        { supplierName: { contains: f.q, mode: "insensitive" } },
        { description: { contains: f.q, mode: "insensitive" } },
      ],
    });
  const where = { AND: and };
  const approvedWhere = { AND: [...and, { status: "APPROVED" as const }] };
  const page = f.page ?? 1;
  const zero = new Prisma.Decimal(0);
  const [total, approved, pending, unpaid, invoices] = await Promise.all([
    db.purchaseInvoice.count({ where }),
    db.purchaseInvoice.aggregate({ where: approvedWhere, _sum: { totalAmount: true, vatAmount: true, netAmount: true }, _count: true }),
    db.purchaseInvoice.aggregate({ where: { AND: [...and, { status: "PENDING_REVIEW" as const }] }, _sum: { totalAmount: true }, _count: true }),
    db.purchaseInvoice.aggregate({ where: { AND: [...and, { status: "APPROVED" as const, paymentStatus: "UNPAID" as const }] }, _sum: { totalAmount: true }, _count: true }),
    db.purchaseInvoice.findMany({
      where,
      orderBy: [{ invoiceDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PURCHASES_PAGE_SIZE,
      take: PURCHASES_PAGE_SIZE,
      include: { branch: { select: { nameAr: true } }, category: { select: { nameAr: true } } },
    }),
  ]);
  return {
    filters: f,
    page,
    total,
    pages: Math.max(1, Math.ceil(total / PURCHASES_PAGE_SIZE)),
    invoices,
    sums: {
      approvedTotal: approved._sum.totalAmount ?? zero,
      approvedVat: approved._sum.vatAmount ?? zero,
      approvedNet: approved._sum.netAmount ?? zero,
      approvedCount: approved._count,
      pendingTotal: pending._sum.totalAmount ?? zero,
      pendingCount: pending._count,
      unpaidTotal: unpaid._sum.totalAmount ?? zero,
      unpaidCount: unpaid._count,
    },
  };
}

export async function getPurchase(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "purchases.view");
  const p = await loadPurchase(db, actor, id);
  const ids = [p.createdById, p.approvedById, p.rejectedById].filter((x): x is string => !!x);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return { invoice: p, userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string> };
}

// ───── التصنيفات ─────

export async function listCategories(db: Db, opts: { includeInactive?: boolean } = {}) {
  return db.expenseCategory.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
    include: { _count: { select: { invoices: true } } },
  });
}

export async function createCategory(db: Db, actor: Actor, name: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.approve");
  const nameAr = parseInput(z.string().trim().min(2, "اكتب اسم التصنيف").max(80), name);
  try {
    return await db.$transaction(async (tx) => {
      const c = await tx.expenseCategory.create({ data: { nameAr } });
      await writeAudit(tx, { actorId: actor.id, action: "expense_category.create", entityType: "expense_category", entityId: c.id, after: { nameAr }, meta });
      return c;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("DUPLICATE", "يوجد تصنيف بنفس الاسم");
    throw e;
  }
}

export async function setCategoryActive(db: Db, actor: Actor, id: string, isActive: boolean, meta: RequestMeta = {}) {
  requirePermission(actor, "purchases.approve");
  const c = await db.expenseCategory.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("التصنيف غير موجود");
  return db.$transaction(async (tx) => {
    const u = await tx.expenseCategory.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, { actorId: actor.id, action: "expense_category.update", entityType: "expense_category", entityId: id, before: { isActive: c.isActive }, after: { isActive }, meta });
    return u;
  });
}
