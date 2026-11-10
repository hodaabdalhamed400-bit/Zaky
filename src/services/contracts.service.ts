import { z } from "zod";
import { Prisma, type ContractStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, branchWhere, requirePermission } from "@/lib/rbac/guard";
import { addDays, dateOnly, todayInRiyadh } from "@/lib/dates";
import { computeContract } from "@/lib/contract-pricing";
import { decimalString, optionalText, parseInput } from "@/lib/validation";
import { assertTenantAccess } from "./access";
import { syncTenantStatus } from "./tenants.service";
import { notify, resolve } from "./notifications.service";

type Tx = Prisma.TransactionClient;

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "مسودة",
  PENDING_APPROVAL: "بانتظار الاعتماد",
  ACTIVE: "نشط",
  EXPIRED: "منتهي",
  CANCELLED: "ملغى",
  TERMINATED: "منهى مبكرًا",
  RENEWED: "مجدد",
};
export const CONTRACT_STATUS_COLOR = {
  DRAFT: "gray",
  PENDING_APPROVAL: "amber",
  ACTIVE: "green",
  EXPIRED: "gray",
  CANCELLED: "red",
  TERMINATED: "red",
  RENEWED: "blue",
} as const;

const VAT_RATE = "0.15"; // قرار معتمد؛ القيمة الفعلية تُقرأ من الإعدادات عند التوفر
async function vatRate(db: Db | Tx) {
  const s = await db.systemSetting.findUnique({ where: { key: "finance.vat_rate" } });
  const v = typeof s?.value === "string" || typeof s?.value === "number" ? String(s.value) : VAT_RATE;
  return /^0(\.\d{1,4})?$/.test(v) ? v : VAT_RATE;
}

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح");

const contractSchema = z.object({
  tenantId: z.string().uuid("اختر المستأجر"),
  branchId: z.string().uuid("اختر الفرع"),
  startDate: ymd,
  durationMonths: z.coerce.number({ message: "المدة غير صحيحة" }).int().min(1, "المدة شهر على الأقل").max(60, "المدة 60 شهرًا كحد أقصى"),
  billingCycle: z.enum(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"], { message: "اختر دورة الدفع" }),
  units: z
    .array(
      z.object({
        unitId: z.string().uuid(),
        seats: z.coerce.number().int().min(1).max(1000).default(1),
        monthlyPrice: decimalString("الإيجار الشهري"),
      }),
    )
    .min(1, "اختر وحدة واحدة على الأقل")
    .max(50),
  discountAmount: decimalString("الخصم", { allowZero: true }).default("0"),
  terms: optionalText(10000),
  notes: optionalText(3000),
});
export type ContractInput = z.input<typeof contractSchema>;

// ───── أدوات داخلية ─────

async function nextContractNo(tx: Tx, branchCode: string, year: string) {
  const key = `CONTRACT-${branchCode}-${year}`;
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (key, last_value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING last_value`;
  return `ZK-${branchCode}-${year}-${String(rows[0]!.last_value).padStart(4, "0")}`;
}

/** يتحقق من الوحدات ويعيد بياناتها؛ يمنع وحدات فرع آخر أو مؤرشفة أو غير نشطة أو للحجوزات. */
async function loadUnits(db: Db | Tx, branchId: string, lines: z.infer<typeof contractSchema>["units"]) {
  const ids = lines.map((l) => l.unitId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", "تكررت وحدة في العقد");
  const units = await db.unit.findMany({ where: { id: { in: ids } }, include: { unitType: true } });
  const byId = new Map(units.map((u) => [u.id, u]));
  return lines.map((l) => {
    const u = byId.get(l.unitId);
    if (!u || u.branchId !== branchId) throw new AppError("VALIDATION", "إحدى الوحدات لا تتبع فرع العقد");
    if (u.archivedAt || u.status === "INACTIVE") throw new AppError("VALIDATION", `الوحدة ${u.code} غير متاحة للتأجير`);
    if (u.unitType.leaseMode !== "LEASE") throw new AppError("VALIDATION", `الوحدة ${u.code} تُدار بالحجوزات وليس بالعقود`);
    const seats = u.occupancyMode === "SHARED" ? l.seats : u.capacity;
    if (u.occupancyMode === "SHARED" && seats > u.capacity) throw new AppError("VALIDATION", `المقاعد المطلوبة في ${u.code} تتجاوز سعتها (${u.capacity})`);
    return { unit: u, seats, monthlyPrice: l.monthlyPrice };
  });
}

/**
 * يتحقق من التعارض مع العقود التي تحجز الوحدات (بانتظار الاعتماد/نشطة).
 * الوحدة الحصرية: أي تداخل بالأيام تعارض. المشتركة: مجموع المقاعد المتداخلة + المطلوبة ≤ السعة
 * (حساب متحفظ: يجمع كل الحجوزات المتداخلة مع الفترة).
 * القرار النهائي لقاعدة البيانات (قيد EXCLUDE) وقفل صفوف الوحدات يمنع السباق في المقاعد.
 */
async function assertNoConflicts(tx: Db | Tx, contractId: string | null, start: string, end: string, lines: Awaited<ReturnType<typeof loadUnits>>, lock = false) {
  if (lock) {
    const ids = lines.map((l) => l.unit.id);
    await (tx as Tx).$queryRaw`SELECT id FROM units WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  }
  for (const l of lines) {
    const overlapping = await tx.contractUnit.findMany({
      where: {
        unitId: l.unit.id,
        blocksOccupancy: true,
        ...(contractId ? { contractId: { not: contractId } } : {}),
        startDate: { lte: dateOnly(end) },
        endDate: { gte: dateOnly(start) },
        contract: { status: { in: ["PENDING_APPROVAL", "ACTIVE"] } },
      },
      include: { contract: { select: { contractNo: true } } },
    });
    if (l.unit.occupancyMode === "EXCLUSIVE" && overlapping.length)
      throw new AppError("CONFLICT", `الوحدة ${l.unit.code} محجوزة في هذه الفترة بالعقد ${overlapping[0]!.contract.contractNo}`);
    if (l.unit.occupancyMode === "SHARED") {
      const used = overlapping.reduce((a, o) => a + o.seats, 0);
      if (used + l.seats > l.unit.capacity)
        throw new AppError("CONFLICT", `المقاعد المتاحة في ${l.unit.code} خلال الفترة: ${Math.max(0, l.unit.capacity - used)} فقط`);
    }
  }
}

function mapDbConflict(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("contract_units_no_overlap")) throw new AppError("CONFLICT", "تعارض: إحدى الوحدات محجوزة بعقد آخر في نفس الفترة");
  throw e;
}

async function snapshot(tx: Tx, contractId: string, reason: string, actorId: string | null) {
  const c = await tx.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { units: { include: { unit: { select: { code: true } } } }, tenant: { select: { name: true } } },
  });
  const versionNo = (await tx.contractVersion.count({ where: { contractId } })) + 1;
  await tx.contractVersion.create({
    data: { contractId, versionNo, changeReason: reason, createdById: actorId, snapshot: JSON.parse(JSON.stringify(c)) },
  });
  await tx.contract.update({ where: { id: contractId }, data: { currentVersion: versionNo } });
}

const AUDIT_FIELDS = ["contractNo", "status", "tenantId", "branchId", "startDate", "endDate", "durationMonths", "billingCycle", "rentAmount", "discountAmount", "vatAmount", "totalAmount", "terms", "notes"] as const;
const pick = (c: Record<string, unknown>) =>
  Object.fromEntries(
    AUDIT_FIELDS.map((k) => {
      const v = c[k];
      return [k, v instanceof Prisma.Decimal ? v.toFixed(2) : v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null)];
    }),
  );

async function getForAction(db: Db | Tx, actor: Actor, id: string) {
  const c = await db.contract.findUnique({ where: { id } });
  if (!c) throw new NotFoundError("العقد غير موجود");
  assertBranchAccess(actor, c.branchId);
  return c;
}

function canEditDraft(actor: Actor, c: { createdById: string | null }) {
  return actor.permissions.has("contracts.edit") || (actor.permissions.has("contracts.create") && c.createdById === actor.id);
}

// ───── الإنشاء والتعديل ─────

async function prepare(db: Db, actor: Actor, raw: unknown, contractId: string | null) {
  const input = parseInput(contractSchema, raw);
  assertBranchAccess(actor, input.branchId);
  await assertTenantAccess(db, actor, input.tenantId);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: input.tenantId } });
  if (tenant.archivedAt) throw new AppError("VALIDATION", "العميل مؤرشف");
  const branch = await db.branch.findUniqueOrThrow({ where: { id: input.branchId } });
  if (branch.status === "INACTIVE") throw new AppError("VALIDATION", "لا يمكن إنشاء عقد في فرع موقوف");
  const lines = await loadUnits(db, input.branchId, input.units);
  let calc;
  try {
    calc = computeContract({
      startDate: input.startDate,
      durationMonths: input.durationMonths,
      billingCycle: input.billingCycle,
      monthlyPrices: lines.map((l) => l.monthlyPrice),
      discount: input.discountAmount,
      vatRate: await vatRate(db),
    });
  } catch (e) {
    throw new AppError("VALIDATION", e instanceof Error ? e.message : "بيانات العقد غير صحيحة");
  }
  await assertNoConflicts(db, contractId, input.startDate, calc.endDate, lines);
  return { input, branch, lines, calc };
}

function contractData(p: Awaited<ReturnType<typeof prepare>>, rate: string) {
  return {
    tenantId: p.input.tenantId,
    branchId: p.input.branchId,
    startDate: dateOnly(p.input.startDate),
    endDate: dateOnly(p.calc.endDate),
    durationMonths: p.input.durationMonths,
    billingCycle: p.input.billingCycle,
    rentAmount: p.calc.rent,
    discountAmount: p.calc.discount,
    vatRate: rate,
    vatAmount: p.calc.vat,
    totalAmount: p.calc.total,
    depositAmount: 0, // لا يوجد تأمين (قرار معتمد)
    terms: p.input.terms,
    notes: p.input.notes,
  };
}

function unitRows(p: Awaited<ReturnType<typeof prepare>>, contractId: string) {
  return p.lines.map((l) => ({
    contractId,
    unitId: l.unit.id,
    branchId: l.unit.branchId,
    seats: l.seats,
    price: l.monthlyPrice,
    startDate: dateOnly(p.input.startDate),
    endDate: dateOnly(p.calc.endDate),
    occupancyMode: l.unit.occupancyMode,
    blocksOccupancy: false,
  }));
}

export async function createContract(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}, opts: { previousContractId?: string; systemActor?: boolean } = {}) {
  if (!opts.systemActor) requirePermission(actor, "contracts.create");
  const p = await prepare(db, actor, raw, null);
  const rate = await vatRate(db);
  const year = todayInRiyadh().slice(0, 4);
  try {
    return await db.$transaction(async (tx) => {
      const contractNo = await nextContractNo(tx, p.branch.code, year);
      const c = await tx.contract.create({
        data: {
          ...contractData(p, rate),
          contractNo,
          status: "DRAFT",
          createdById: opts.systemActor ? null : actor.id,
          previousContractId: opts.previousContractId ?? null,
        },
      });
      await tx.contractUnit.createMany({ data: unitRows(p, c.id) });
      await writeAudit(tx, {
        actorId: opts.systemActor ? null : actor.id,
        action: opts.previousContractId ? "contract.renewal_draft" : "contract.create",
        entityType: "contract",
        entityId: c.id,
        branchId: c.branchId,
        after: { ...pick(c), units: p.lines.map((l) => ({ code: l.unit.code, seats: l.seats, monthlyPrice: l.monthlyPrice })) },
        meta,
      });
      return c;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target).includes("previous_contract_id"))
      throw new AppError("DUPLICATE", "يوجد تجديد مسجل لهذا العقد بالفعل");
    throw e;
  }
}

export async function updateDraft(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  const existing = await getForAction(db, actor, id);
  if (existing.status !== "DRAFT") throw new AppError("STATE", "لا يمكن تعديل بيانات العقد إلا وهو مسودة");
  if (!canEditDraft(actor, existing)) throw new ForbiddenError();
  const p = await prepare(db, actor, raw, id);
  if (p.input.branchId !== existing.branchId) throw new AppError("VALIDATION", "لا يمكن تغيير فرع العقد؛ أنشئ عقدًا جديدًا");
  if (existing.previousContractId && p.input.tenantId !== existing.tenantId) throw new AppError("VALIDATION", "لا يمكن تغيير مستأجر عقد التجديد");
  const rate = await vatRate(db);
  return db.$transaction(async (tx) => {
    const c = await tx.contract.update({ where: { id }, data: { ...contractData(p, rate), rejectionReason: null } });
    await tx.contractUnit.deleteMany({ where: { contractId: id } });
    await tx.contractUnit.createMany({ data: unitRows(p, id) });
    await writeAudit(tx, { actorId: actor.id, action: "contract.update", entityType: "contract", entityId: id, branchId: c.branchId, before: pick(existing), after: pick(c), meta });
    return c;
  });
}

/** بعد الاعتماد: تعديل الشروط والملاحظات فقط، مع نسخة جديدة (لا تعديل مالي — يلزم عقد جديد/تجديد). */
export async function updateTerms(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "contracts.edit");
  const existing = await getForAction(db, actor, id);
  if (existing.status !== "ACTIVE") throw new AppError("STATE", "تعديل الشروط متاح للعقود النشطة فقط");
  const input = parseInput(z.object({ terms: optionalText(10000), notes: optionalText(3000), reason: z.string().trim().min(3, "اذكر سبب التعديل").max(500) }), raw);
  return db.$transaction(async (tx) => {
    const c = await tx.contract.update({ where: { id }, data: { terms: input.terms, notes: input.notes } });
    await snapshot(tx, id, `تعديل الشروط: ${input.reason}`, actor.id);
    await writeAudit(tx, { actorId: actor.id, action: "contract.terms_update", entityType: "contract", entityId: id, branchId: c.branchId, before: { terms: existing.terms, notes: existing.notes }, after: { terms: c.terms, notes: c.notes, reason: input.reason }, meta });
    return c;
  });
}

// ───── دورة الاعتماد ─────

export async function submitForApproval(db: Db, actor: Actor, id: string, meta: RequestMeta = {}) {
  const c = await getForAction(db, actor, id);
  if (c.status !== "DRAFT") throw new AppError("STATE", "العقد ليس مسودة");
  if (!canEditDraft(actor, c)) throw new ForbiddenError();
  try {
    return await db.$transaction(async (tx) => {
      const rows = await tx.contractUnit.findMany({ where: { contractId: id }, include: { unit: { include: { unitType: true } } } });
      const lines = rows.map((r) => ({ unit: r.unit, seats: r.seats, monthlyPrice: r.price.toFixed(2) }));
      for (const l of lines) {
        if (l.unit.archivedAt || l.unit.status === "INACTIVE") throw new AppError("VALIDATION", `الوحدة ${l.unit.code} لم تعد متاحة`);
      }
      await assertNoConflicts(tx, id, c.startDate.toISOString().slice(0, 10), c.endDate.toISOString().slice(0, 10), lines, true);
      // من هنا تحجز الوحدات، ويطبَّق قيد EXCLUDE في قاعدة البيانات
      await tx.contractUnit.updateMany({ where: { contractId: id }, data: { blocksOccupancy: true } });
      const u = await tx.contract.update({ where: { id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date(), rejectionReason: null } });
      await writeAudit(tx, { actorId: actor.id, action: "contract.submit", entityType: "contract", entityId: id, branchId: c.branchId, meta });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true } });
      await notify(tx, {
        type: "CONTRACT_PENDING_APPROVAL",
        title: `عقد بانتظار الاعتماد: ${c.contractNo}`,
        body: `${tenant.name} — الإجمالي ${c.totalAmount.toFixed(2)} ر.س`,
        link: `/contracts/${id}`,
        entityType: "contract",
        entityId: id,
        dedupeKey: `CONTRACT_PENDING_APPROVAL:${id}:${Date.now()}`,
        branchId: c.branchId,
        permission: "contracts.approve",
        excludeUserId: actor.id,
      });
      return u;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (e) {
    mapDbConflict(e);
  }
}

/** الاعتماد: ينشئ جدول الأقساط ونسخة العقد الأولى، ويُفعّل العميل — في معاملة واحدة. */
export async function approveContract(db: Db, actor: Actor, id: string, meta: RequestMeta = {}) {
  requirePermission(actor, "contracts.approve");
  const c = await getForAction(db, actor, id);
  if (c.status !== "PENDING_APPROVAL") throw new AppError("STATE", "العقد ليس بانتظار الاعتماد");
  const rows = await db.contractUnit.findMany({ where: { contractId: id } });
  const calc = computeContract({
    startDate: c.startDate.toISOString().slice(0, 10),
    durationMonths: c.durationMonths,
    billingCycle: c.billingCycle as "MONTHLY",
    monthlyPrices: rows.map((r) => r.price),
    discount: c.discountAmount,
    vatRate: c.vatRate,
  });
  if (!calc.total.equals(c.totalAmount)) throw new AppError("INTEGRITY", "إجمالي العقد لا يطابق الحساب؛ أعد حفظ المسودة");
  return db.$transaction(async (tx) => {
    // حماية من الاعتماد المزدوج المتزامن
    const locked = await tx.contract.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "ACTIVE", approvedById: actor.id, approvedAt: new Date() } });
    if (locked.count !== 1) throw new AppError("STATE", "تم تغيير حالة العقد بالفعل");
    await tx.paymentSchedule.createMany({
      data: calc.installments.map((i) => ({
        contractId: id,
        seqNo: i.seqNo,
        periodStart: dateOnly(i.periodStart),
        periodEnd: dateOnly(i.periodEnd),
        dueDate: dateOnly(i.dueDate),
        netAmount: i.net,
        vatAmount: i.vat,
        amountDue: i.amountDue,
      })),
    });
    await snapshot(tx, id, "اعتماد العقد", actor.id);
    await syncTenantStatus(tx, c.tenantId);
    await writeAudit(tx, { actorId: actor.id, action: "contract.approve", entityType: "contract", entityId: id, branchId: c.branchId, after: { installments: calc.installments.length, total: calc.total.toFixed(2) }, meta });
    await resolve(tx, ["CONTRACT_PENDING_APPROVAL"], [id]);
    return tx.contract.findUniqueOrThrow({ where: { id } });
  });
}

export async function rejectContract(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  requirePermission(actor, "contracts.approve");
  const c = await getForAction(db, actor, id);
  if (c.status !== "PENDING_APPROVAL") throw new AppError("STATE", "العقد ليس بانتظار الاعتماد");
  const r = parseInput(z.string().trim().min(3, "اذكر سبب الإرجاع").max(1000), reason);
  return db.$transaction(async (tx) => {
    await tx.contractUnit.updateMany({ where: { contractId: id }, data: { blocksOccupancy: false } });
    const u = await tx.contract.update({ where: { id }, data: { status: "DRAFT", rejectionReason: r } });
    await writeAudit(tx, { actorId: actor.id, action: "contract.reject", entityType: "contract", entityId: id, branchId: c.branchId, after: { reason: r }, meta });
    await resolve(tx, ["CONTRACT_PENDING_APPROVAL"], [id]);
    return u;
  });
}

/** إلغاء عقد لم يبدأ سريانه (مسودة أو بانتظار الاعتماد). */
export async function cancelContract(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  const c = await getForAction(db, actor, id);
  if (c.status !== "DRAFT" && c.status !== "PENDING_APPROVAL") throw new AppError("STATE", "الإلغاء متاح قبل الاعتماد فقط؛ استخدم الإنهاء للعقود النشطة");
  if (!actor.permissions.has("contracts.terminate") && !canEditDraft(actor, c)) throw new ForbiddenError();
  const r = parseInput(z.string().trim().min(3, "اذكر سبب الإلغاء").max(1000), reason);
  return db.$transaction(async (tx) => {
    await tx.contractUnit.updateMany({ where: { contractId: id }, data: { blocksOccupancy: false } });
    const u = await tx.contract.update({ where: { id }, data: { status: "CANCELLED", endReason: r } });
    await writeAudit(tx, { actorId: actor.id, action: "contract.cancel", entityType: "contract", entityId: id, branchId: c.branchId, after: { reason: r }, meta });
    await resolve(tx, ["CONTRACT_PENDING_APPROVAL"], [id]);
    return u;
  });
}

// ───── الإنهاء المبكر ─────

const terminateSchema = z.object({
  exitDate: ymd,
  reason: z.string().trim().min(3, "اذكر سبب الإنهاء").max(1000),
  // قرار معتمد: مصير الأقساط المستقبلية يُحدد حسب الاتفاق مع الشركة لكل عقد
  policy: z.enum(["KEEP_DUE", "CANCEL_FUTURE"], { message: "حدد مصير الأقساط المستقبلية حسب الاتفاق" }),
});

/**
 * الإنهاء المبكر: لا يُسترد أي مبلغ مدفوع (قرار معتمد).
 * - KEEP_DUE: تبقى كل الأقساط مستحقة.
 * - CANCEL_FUTURE: تُلغى الأقساط التي تبدأ فترتها بعد تاريخ الخروج ولم يُدفع منها شيء
 *   (القسط المدفوع جزئيًا يبقى ويُعالج بتسوية في المرحلة الرابعة).
 * تنتهي حجوزات الوحدات بتاريخ الخروج فتصبح متاحة من اليوم التالي.
 */
export async function terminateContract(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "contracts.terminate");
  const c = await getForAction(db, actor, id);
  if (c.status !== "ACTIVE") throw new AppError("STATE", "الإنهاء متاح للعقود النشطة فقط");
  const input = parseInput(terminateSchema, raw);
  const start = c.startDate.toISOString().slice(0, 10);
  const end = c.endDate.toISOString().slice(0, 10);
  if (input.exitDate < start || input.exitDate >= end) throw new AppError("VALIDATION", "تاريخ الخروج يجب أن يكون بين بداية العقد وما قبل نهايته");
  const renewal = await db.contract.findFirst({ where: { previousContractId: id, status: { in: ["PENDING_APPROVAL", "ACTIVE"] } } });
  if (renewal) throw new AppError("STATE", `للعقد تجديد معتمد أو قيد الاعتماد (${renewal.contractNo})؛ ألغه أولًا`);
  return db.$transaction(async (tx) => {
    let cancelled = 0;
    if (input.policy === "CANCEL_FUTURE") {
      const r = await tx.paymentSchedule.updateMany({
        where: { contractId: id, periodStart: { gt: dateOnly(input.exitDate) }, status: "PENDING", amountPaid: 0 },
        data: { status: "CANCELLED" },
      });
      cancelled = r.count;
    }
    await tx.contractUnit.updateMany({ where: { contractId: id }, data: { endDate: dateOnly(input.exitDate) } });
    const u = await tx.contract.update({
      where: { id },
      data: { status: "TERMINATED", endedAt: dateOnly(input.exitDate), endReason: input.reason, earlyExitPolicy: input.policy },
    });
    await snapshot(tx, id, `إنهاء مبكر: ${input.reason}`, actor.id);
    await syncTenantStatus(tx, c.tenantId);
    await writeAudit(tx, { actorId: actor.id, action: "contract.terminate", entityType: "contract", entityId: id, branchId: c.branchId, after: { ...input, cancelledInstallments: cancelled, refund: "لا يُسترد" }, meta });
    return { contract: u, cancelledInstallments: cancelled };
  });
}

// ───── التجديد ─────

/** ينشئ مسودة تجديد مرتبطة بالعقد السابق: تبدأ في اليوم التالي لنهايته بنفس المدة والوحدات، والسعر قابل للتعديل حسب الاتفاق. */
export async function createRenewalDraft(db: Db, actor: Actor, id: string, meta: RequestMeta = {}, opts: { systemActor?: boolean } = {}) {
  if (!opts.systemActor) requirePermission(actor, "contracts.create");
  const c = await db.contract.findUnique({ where: { id }, include: { units: { include: { unit: { include: { unitType: true } } } }, renewedBy: true } });
  if (!c) throw new NotFoundError("العقد غير موجود");
  if (!opts.systemActor) assertBranchAccess(actor, c.branchId);
  if (c.status !== "ACTIVE" && c.status !== "EXPIRED") throw new AppError("STATE", "التجديد متاح للعقود النشطة أو المنتهية فقط");
  if (c.renewedBy && c.renewedBy.status !== "CANCELLED") throw new AppError("DUPLICATE", `يوجد تجديد لهذا العقد: ${c.renewedBy.contractNo}`);
  if (c.renewedBy?.status === "CANCELLED") {
    // التجديد الملغى يحرر الرابط حتى يمكن إنشاء تجديد جديد
    await db.$transaction(async (tx) => {
      await tx.contract.update({ where: { id: c.renewedBy!.id }, data: { previousContractId: null } });
      await writeAudit(tx, { actorId: opts.systemActor ? null : actor.id, action: "contract.renewal_unlinked", entityType: "contract", entityId: c.renewedBy!.id, before: { previousContractId: c.id } });
    });
  }
  const eligible = c.units.filter((cu) => !cu.unit.archivedAt && cu.unit.status !== "INACTIVE" && cu.unit.unitType.leaseMode === "LEASE");
  if (!eligible.length) throw new AppError("VALIDATION", "لا توجد وحدات من العقد السابق متاحة للتجديد");
  const startDate = addDays(c.endDate.toISOString().slice(0, 10), 1);
  return createContract(
    db,
    actor,
    {
      tenantId: c.tenantId,
      branchId: c.branchId,
      startDate,
      durationMonths: c.durationMonths,
      billingCycle: c.billingCycle,
      units: eligible.map((cu) => ({ unitId: cu.unitId, seats: cu.seats, monthlyPrice: cu.price.toFixed(2) })),
      discountAmount: "0",
      terms: c.terms,
      notes: `تجديد للعقد ${c.contractNo} — السعر حسب الاتفاق مع مسؤول الفرع`,
    },
    meta,
    { previousContractId: c.id, systemActor: opts.systemActor },
  );
}

// ───── القوائم والتفاصيل ─────

export const contractFiltersSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "EXPIRED", "CANCELLED", "TERMINATED", "RENEWED"]).optional().catch(undefined),
  branchId: z.string().uuid().optional().catch(undefined),
  tenantId: z.string().uuid().optional().catch(undefined),
  expiring: z.enum(["7", "15", "30", "60", "90"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().catch(undefined),
});
export const CONTRACTS_PAGE_SIZE = 30;

export async function listContracts(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "contracts.view");
  const f = contractFiltersSchema.parse(raw ?? {});
  if (f.branchId) assertBranchAccess(actor, f.branchId);
  const and: Prisma.ContractWhereInput[] = [branchWhere(actor, "branchId")];
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.tenantId) and.push({ tenantId: f.tenantId });
  if (f.status) and.push({ status: f.status });
  if (f.expiring) {
    const today = todayInRiyadh();
    and.push({ status: "ACTIVE", endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, Number(f.expiring))) } });
  }
  if (f.q) and.push({ OR: [{ contractNo: { contains: f.q, mode: "insensitive" } }, { tenant: { name: { contains: f.q, mode: "insensitive" } } }, { units: { some: { unit: { code: { contains: f.q, mode: "insensitive" } } } } }] });
  const where = { AND: and };
  const page = f.page ?? 1;
  const [total, contracts] = await Promise.all([
    db.contract.count({ where }),
    db.contract.findMany({
      where,
      orderBy: f.expiring ? [{ endDate: "asc" }] : [{ createdAt: "desc" }],
      skip: (page - 1) * CONTRACTS_PAGE_SIZE,
      take: CONTRACTS_PAGE_SIZE,
      include: {
        tenant: { select: { id: true, name: true } },
        branch: { select: { nameAr: true } },
        units: { include: { unit: { select: { code: true } } } },
      },
    }),
  ]);
  return { filters: f, page, total, pages: Math.max(1, Math.ceil(total / CONTRACTS_PAGE_SIZE)), contracts };
}

export async function getContract(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "contracts.view");
  const c = await db.contract.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true, mobile: true, type: true } },
      branch: { select: { id: true, nameAr: true, code: true } },
      units: { include: { unit: { include: { unitType: { select: { nameAr: true } }, floor: { select: { name: true } } } } } },
      schedules: { orderBy: { seqNo: "asc" } },
      versions: { orderBy: { versionNo: "desc" }, select: { id: true, versionNo: true, changeReason: true, createdAt: true, createdById: true } },
      previousContract: { select: { id: true, contractNo: true } },
      renewedBy: { select: { id: true, contractNo: true, status: true } },
    },
  });
  if (!c) throw new NotFoundError("العقد غير موجود");
  assertBranchAccess(actor, c.branchId);
  const userIds = [c.createdById, c.approvedById, ...c.versions.map((v) => v.createdById)].filter((x): x is string => !!x);
  const users = await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  return { contract: c, userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string> };
}

/** خيارات نموذج العقد: المستأجرون والوحدات المتاحة في فروع المستخدم. */
export async function contractFormOptions(db: Db, actor: Actor) {
  requirePermission(actor, "contracts.create");
  const branchFilter = branchWhere(actor, "id");
  const [branches, tenants, units] = await Promise.all([
    db.branch.findMany({ where: { status: { not: "INACTIVE" }, ...branchFilter }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
    db.tenant.findMany({
      where: { archivedAt: null, ...(actor.allBranches ? {} : { OR: [{ primaryBranchId: { in: [...actor.branchIds] } }, { contracts: { some: { branchId: { in: [...actor.branchIds] } } } }] }) },
      orderBy: { name: "asc" },
      take: 2000,
      select: { id: true, name: true, mobile: true, primaryBranchId: true },
    }),
    db.unit.findMany({
      where: { archivedAt: null, status: { not: "INACTIVE" }, unitType: { leaseMode: "LEASE" }, ...branchWhere(actor, "branchId") },
      orderBy: [{ code: "asc" }],
      select: { id: true, code: true, branchId: true, capacity: true, occupancyMode: true, basePrice: true, pricingCycle: true, status: true, unitType: { select: { nameAr: true } } },
    }),
  ]);
  return {
    branches,
    tenants,
    units: units.map((u) => ({ ...u, basePrice: u.basePrice.toFixed(2) })),
  };
}

// ───── المهام اليومية ─────

/**
 * - العقود النشطة التي انتهت مدتها: تصبح "مجدد" إن كان لها تجديد معتمد، وإلا "منتهي".
 * - مسودات التجديد: تُنشأ تلقائيًا قبل الانتهاء بعدد أيام الإعداد (قرار معتمد).
 */
export async function runContractMaintenance(db: Db, today = todayInRiyadh()) {
  const ended = await db.contract.findMany({
    where: { status: "ACTIVE", endDate: { lt: dateOnly(today) } },
    include: { renewedBy: { select: { status: true } } },
  });
  let expired = 0;
  let renewed = 0;
  for (const c of ended) {
    const next = c.renewedBy && c.renewedBy.status === "ACTIVE" ? "RENEWED" : "EXPIRED";
    await db.$transaction(async (tx) => {
      const r = await tx.contract.updateMany({ where: { id: c.id, status: "ACTIVE" }, data: { status: next, endedAt: c.endDate } });
      if (r.count) {
        await writeAudit(tx, { action: next === "RENEWED" ? "contract.renewed" : "contract.expire", entityType: "contract", entityId: c.id, branchId: c.branchId });
        await syncTenantStatus(tx, c.tenantId);
      }
    });
    if (next === "RENEWED") renewed++;
    else expired++;
  }

  const setting = await db.systemSetting.findUnique({ where: { key: "contract.renewal_draft_days" } });
  const days = typeof setting?.value === "number" ? setting.value : 30;
  const due = await db.contract.findMany({
    where: { status: "ACTIVE", endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, days)) }, renewedBy: null },
    select: { id: true, contractNo: true },
  });
  let drafts = 0;
  const skipped: string[] = [];
  const system = { id: "system", permissions: new Set<string>(), allBranches: true, branchIds: [] } as unknown as Actor;
  for (const c of due) {
    try {
      const d = await createRenewalDraft(db, system, c.id, {}, { systemActor: true });
      drafts++;
      await notify(db, {
        type: "SYSTEM",
        title: `مسودة تجديد جاهزة: ${d.contractNo}`,
        body: `تجديد للعقد ${c.contractNo} — راجع السعر حسب الاتفاق ثم أرسلها للاعتماد`,
        link: `/contracts/${d.id}`,
        entityType: "contract",
        entityId: d.id,
        dedupeKey: `RENEWAL_DRAFT:${d.id}`,
        branchId: d.branchId,
        permission: "contracts.create",
      });
    } catch (e) {
      // مثال: الوحدة محجوزة لعميل آخر بعد الانتهاء — تبقى للمعالجة اليدوية
      skipped.push(`${c.contractNo}: ${e instanceof Error ? e.message : "خطأ"}`);
    }
  }
  return { expired, renewed, renewalDrafts: drafts, skipped };
}
