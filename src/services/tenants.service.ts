import { z } from "zod";
import { Prisma, type TenantStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh, addDays } from "@/lib/dates";
import { optionalText, parseInput, phoneSchema } from "@/lib/validation";
import { assertTenantAccess, tenantScope } from "./access";

export const TENANT_STATUS_LABELS: Record<TenantStatus, string> = { PROSPECT: "محتمل", ACTIVE: "نشط", FORMER: "سابق" };
export const TENANT_STATUS_COLOR = { PROSPECT: "blue", ACTIVE: "green", FORMER: "gray" } as const;

const digits = (label: string, len?: number) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\s/g, ""))
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || (/^\d+$/.test(v) && (!len || v.length === len)), len ? `${label} يجب أن يكون ${len} أرقام` : `${label} أرقام فقط`);

const tenantSchema = z.object({
  type: z.enum(["INDIVIDUAL", "COMPANY"], { message: "اختر نوع العميل" }),
  name: z.string().trim().min(2, "الاسم قصير جدًا").max(200),
  contactPersonName: optionalText(120),
  mobile: phoneSchema,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .refine((v) => !v || z.string().email().safeParse(v).success, "البريد الإلكتروني غير صحيح"),
  crNumber: digits("رقم السجل التجاري", 10),
  nationalId: digits("رقم الهوية", 10),
  vatNumber: digits("الرقم الضريبي", 15),
  nationalAddress: optionalText(300),
  primaryBranchId: z.string().uuid("اختر الفرع"),
  status: z.enum(["PROSPECT", "ACTIVE", "FORMER"]).default("PROSPECT"),
  notes: optionalText(2000),
  // تأكيد صريح عند وجود عميل مشابه (نفس الجوال أو البريد)
  confirmDuplicate: z.boolean().default(false),
});

const AUDIT_FIELDS = ["type", "name", "contactPersonName", "mobile", "email", "crNumber", "nationalId", "vatNumber", "nationalAddress", "primaryBranchId", "status", "notes"] as const;
const pick = (t: Record<string, unknown>) => Object.fromEntries(AUDIT_FIELDS.map((k) => [k, t[k] ?? null]));

function uniqueError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = String((e.meta as { target?: unknown })?.target ?? "");
    const which = target.includes("cr_number") ? "رقم السجل التجاري" : target.includes("national_id") ? "رقم الهوية" : target.includes("vat") ? "الرقم الضريبي" : "البيانات";
    throw new AppError("DUPLICATE", `${which} مسجل لعميل آخر`);
  }
  // قيود الفهارس الجزئية تصل أحيانًا كخطأ غير مصنف
  const msg = e instanceof Error ? e.message : "";
  for (const [idx, label] of [["tenants_cr_number_unique", "رقم السجل التجاري"], ["tenants_national_id_unique", "رقم الهوية"], ["tenants_vat_number_unique", "الرقم الضريبي"]] as const)
    if (msg.includes(idx)) throw new AppError("DUPLICATE", `${label} مسجل لعميل آخر`);
  throw e;
}

/** يزيل الحقول الحساسة لمن لا يملك صلاحيتها (لا تُرسل للمتصفح أصلًا). */
export function redactTenant<T extends { nationalId: string | null }>(actor: Actor, t: T): T & { nationalIdHidden: boolean } {
  const can = actor.permissions.has("tenants.view_sensitive");
  return { ...t, nationalId: can ? t.nationalId : null, nationalIdHidden: !can && !!t.nationalId };
}

export const tenantFiltersSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  status: z.enum(["PROSPECT", "ACTIVE", "FORMER"]).optional().catch(undefined),
  branchId: z.string().uuid().optional().catch(undefined),
  archived: z.enum(["1"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().catch(undefined),
});
export const TENANTS_PAGE_SIZE = 30;

export async function listTenants(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "tenants.view");
  const f = tenantFiltersSchema.parse(raw ?? {});
  if (f.branchId) assertBranchAccess(actor, f.branchId);
  const and: Prisma.TenantWhereInput[] = [tenantScope(actor), f.archived ? { archivedAt: { not: null } } : { archivedAt: null }];
  if (f.status) and.push({ status: f.status });
  if (f.branchId) and.push({ OR: [{ primaryBranchId: f.branchId }, { contracts: { some: { branchId: f.branchId } } }] });
  if (f.q) {
    const q = f.q;
    const or: Prisma.TenantWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { contactPersonName: { contains: q, mode: "insensitive" } },
      { mobile: { contains: q.replace(/\s/g, "") } },
      { email: { contains: q.toLowerCase() } },
      { crNumber: { contains: q } },
      { vatNumber: { contains: q } },
      { contracts: { some: { contractNo: { contains: q, mode: "insensitive" } } } },
    ];
    // البحث برقم الهوية فقط لمن يملك صلاحية رؤيته (حتى لا يُستنتج بالتجربة)
    if (actor.permissions.has("tenants.view_sensitive")) or.push({ nationalId: { contains: q } });
    and.push({ OR: or });
  }
  const where = { AND: and };
  const page = f.page ?? 1;
  const [total, rows] = await Promise.all([
    db.tenant.count({ where }),
    db.tenant.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * TENANTS_PAGE_SIZE,
      take: TENANTS_PAGE_SIZE,
      include: {
        primaryBranch: { select: { id: true, nameAr: true } },
        _count: { select: { contracts: { where: { status: "ACTIVE" } } } },
      },
    }),
  ]);
  return { filters: f, page, total, pages: Math.max(1, Math.ceil(total / TENANTS_PAGE_SIZE)), tenants: rows.map((t) => redactTenant(actor, t)) };
}

export async function getTenant(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "tenants.view");
  await assertTenantAccess(db, actor, id);
  const today = todayInRiyadh();
  const t = await db.tenant.findUniqueOrThrow({
    where: { id },
    include: {
      primaryBranch: { select: { id: true, nameAr: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      interactions: { orderBy: { createdAt: "desc" }, take: 50 },
      contracts: {
        // عقود فروع المستخدم فقط
        where: actor.allBranches ? {} : { branchId: { in: [...actor.branchIds] } },
        orderBy: { startDate: "desc" },
        include: { branch: { select: { nameAr: true } }, units: { include: { unit: { select: { code: true } } } } },
      },
    },
  });
  const contractIds = t.contracts.map((c) => c.id);
  const [balance, authors, createdBy, updatedBy] = await Promise.all([
    actor.permissions.has("payments.view") && contractIds.length
      ? db.$queryRaw<{ due: Prisma.Decimal; overdue: Prisma.Decimal; future: Prisma.Decimal }[]>`
          SELECT
            COALESCE(SUM(amount_due - amount_paid - amount_adjusted) FILTER (WHERE due_date <= ${dateOnly(today)}::date), 0) AS due,
            COALESCE(SUM(amount_due - amount_paid - amount_adjusted) FILTER (WHERE due_date < ${dateOnly(today)}::date), 0) AS overdue,
            COALESCE(SUM(amount_due - amount_paid - amount_adjusted) FILTER (WHERE due_date > ${dateOnly(today)}::date), 0) AS future
          FROM payment_schedules WHERE status IN ('PENDING','PARTIAL') AND contract_id = ANY(${contractIds}::uuid[])`
      : null,
    db.user.findMany({ where: { id: { in: t.interactions.map((i) => i.authorId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    t.createdById ? db.user.findUnique({ where: { id: t.createdById }, select: { name: true } }) : null,
    t.updatedById ? db.user.findUnique({ where: { id: t.updatedById }, select: { name: true } }) : null,
  ]);
  const expiringSoon = t.contracts.filter((c) => c.status === "ACTIVE" && c.endDate <= dateOnly(addDays(today, 30)));
  return {
    tenant: redactTenant(actor, t),
    balance: balance?.[0] ? { due: balance[0].due.toFixed(2), overdue: balance[0].overdue.toFixed(2), future: balance[0].future.toFixed(2) } : null,
    authorNames: Object.fromEntries(authors.map((a) => [a.id, a.name])),
    createdByName: createdBy?.name ?? null,
    updatedByName: updatedBy?.name ?? null,
    expiringSoon,
  };
}

async function findSimilar(db: Db, input: { mobile: string | null; email: string | null }, excludeId?: string) {
  const or: Prisma.TenantWhereInput[] = [];
  if (input.mobile) or.push({ mobile: input.mobile });
  if (input.email) or.push({ email: input.email });
  if (!or.length) return null;
  return db.tenant.findFirst({ where: { OR: or, archivedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true, name: true } });
}

export async function createTenant(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "tenants.manage");
  const input = parseInput(tenantSchema, raw);
  assertBranchAccess(actor, input.primaryBranchId);
  if (input.nationalId && !actor.permissions.has("tenants.view_sensitive"))
    throw new AppError("FORBIDDEN_FIELD", "لا تملك صلاحية إدخال رقم الهوية؛ اتركه فارغًا ليُكمله مستخدم مخول");
  const { confirmDuplicate, ...data } = input;
  if (!confirmDuplicate) {
    const similar = await findSimilar(db, data);
    if (similar) throw new AppError("DUPLICATE_SUSPECT", `يوجد عميل بنفس الجوال أو البريد: «${similar.name}». تحقق منه أو أكّد الإضافة.`);
  }
  try {
    return await db.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: { ...data, createdById: actor.id, updatedById: actor.id } });
      await writeAudit(tx, { actorId: actor.id, action: "tenant.create", entityType: "tenant", entityId: t.id, branchId: t.primaryBranchId, after: pick(t), meta });
      return t;
    });
  } catch (e) {
    uniqueError(e);
  }
}

export async function updateTenant(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "tenants.manage");
  await assertTenantAccess(db, actor, id);
  const existing = await db.tenant.findUniqueOrThrow({ where: { id } });
  if (existing.archivedAt) throw new AppError("ARCHIVED", "العميل مؤرشف");
  const input = parseInput(tenantSchema, raw);
  if (input.primaryBranchId !== existing.primaryBranchId) assertBranchAccess(actor, input.primaryBranchId);
  const { confirmDuplicate, ...data } = input;
  // من لا يملك صلاحية الحقول الحساسة لا يراها ولا يغيّرها (تبقى قيمتها كما هي)
  if (!actor.permissions.has("tenants.view_sensitive")) data.nationalId = existing.nationalId;
  if (!confirmDuplicate && (data.mobile !== existing.mobile || data.email !== existing.email)) {
    const similar = await findSimilar(db, data, id);
    if (similar) throw new AppError("DUPLICATE_SUSPECT", `يوجد عميل بنفس الجوال أو البريد: «${similar.name}». تحقق منه أو أكّد الحفظ.`);
  }
  try {
    return await db.$transaction(async (tx) => {
      const t = await tx.tenant.update({ where: { id }, data: { ...data, updatedById: actor.id } });
      await writeAudit(tx, { actorId: actor.id, action: "tenant.update", entityType: "tenant", entityId: id, branchId: t.primaryBranchId, before: pick(existing), after: pick(t), meta });
      return t;
    });
  } catch (e) {
    uniqueError(e);
  }
}

export async function setTenantArchived(db: Db, actor: Actor, id: string, archived: boolean, meta: RequestMeta = {}) {
  requirePermission(actor, "tenants.manage");
  await assertTenantAccess(db, actor, id);
  if (archived) {
    const live = await db.contract.count({ where: { tenantId: id, status: { in: ["ACTIVE", "PENDING_APPROVAL", "DRAFT"] } } });
    if (live) throw new AppError("HAS_CONTRACTS", "لا يمكن أرشفة عميل لديه عقود نشطة أو مسودات");
  }
  try {
    return await db.$transaction(async (tx) => {
      const t = await tx.tenant.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, updatedById: actor.id } });
      await writeAudit(tx, { actorId: actor.id, action: archived ? "tenant.archive" : "tenant.restore", entityType: "tenant", entityId: id, meta });
      return t;
    });
  } catch (e) {
    uniqueError(e); // الاستعادة قد تتعارض مع عميل أُضيف لاحقًا بنفس السجل
  }
}

// ───── جهات الاتصال وسجل التواصل ─────

const contactSchema = z.object({
  name: z.string().trim().min(2, "اسم جهة الاتصال قصير").max(120),
  title: optionalText(80),
  mobile: phoneSchema,
  email: z.string().trim().toLowerCase().optional().nullable().transform((v) => (v ? v : null)).refine((v) => !v || z.string().email().safeParse(v).success, "البريد غير صحيح"),
  isPrimary: z.boolean().default(false),
});

export async function addContact(db: Db, actor: Actor, tenantId: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "tenants.manage");
  await assertTenantAccess(db, actor, tenantId);
  const input = parseInput(contactSchema, raw);
  return db.$transaction(async (tx) => {
    if (input.isPrimary) await tx.tenantContact.updateMany({ where: { tenantId }, data: { isPrimary: false } });
    const c = await tx.tenantContact.create({ data: { ...input, tenantId } });
    await writeAudit(tx, { actorId: actor.id, action: "tenant.contact_add", entityType: "tenant", entityId: tenantId, after: input, meta });
    return c;
  });
}

export async function removeContact(db: Db, actor: Actor, contactId: string, meta: RequestMeta = {}) {
  requirePermission(actor, "tenants.manage");
  const c = await db.tenantContact.findUnique({ where: { id: contactId } });
  if (!c) throw new NotFoundError("جهة الاتصال غير موجودة");
  await assertTenantAccess(db, actor, c.tenantId);
  await db.$transaction(async (tx) => {
    await tx.tenantContact.delete({ where: { id: contactId } });
    await writeAudit(tx, { actorId: actor.id, action: "tenant.contact_remove", entityType: "tenant", entityId: c.tenantId, before: { name: c.name, mobile: c.mobile }, meta });
  });
}

const interactionSchema = z.object({
  channel: z.enum(["CALL", "VISIT", "EMAIL", "WHATSAPP", "NOTE"], { message: "اختر وسيلة التواصل" }),
  body: z.string().trim().min(2, "اكتب الملاحظة").max(3000),
});
export const CHANNEL_LABELS = { CALL: "اتصال", VISIT: "زيارة", EMAIL: "بريد", WHATSAPP: "واتساب", NOTE: "ملاحظة" } as const;

/** سجل التواصل للإضافة فقط (لا تعديل ولا حذف) */
export async function addInteraction(db: Db, actor: Actor, tenantId: string, raw: unknown) {
  requirePermission(actor, "tenants.view");
  await assertTenantAccess(db, actor, tenantId);
  const input = parseInput(interactionSchema, raw);
  return db.tenantInteraction.create({ data: { ...input, tenantId, authorId: actor.id } });
}

/** يحدّث حالة العميل تلقائيًا من عقوده: نشط إذا لديه عقد نشط، سابق إذا انتهت كل عقوده. */
export async function syncTenantStatus(tx: Prisma.TransactionClient | Db, tenantId: string) {
  const [active, ever] = await Promise.all([
    tx.contract.count({ where: { tenantId, status: "ACTIVE" } }),
    tx.contract.count({ where: { tenantId, status: { in: ["EXPIRED", "TERMINATED", "RENEWED"] } } }),
  ]);
  const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true } });
  const next: TenantStatus = active > 0 ? "ACTIVE" : ever > 0 ? "FORMER" : t.status;
  if (next !== t.status) await tx.tenant.update({ where: { id: tenantId }, data: { status: next } });
  return next;
}
