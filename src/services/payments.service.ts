import { z } from "zod";
import { Prisma, type PaymentMethod, type PaymentStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, branchWhere, requirePermission } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh } from "@/lib/dates";
import { money } from "@/lib/money";
import { decimalString, optionalText, parseInput } from "@/lib/validation";

type Tx = Prisma.TransactionClient;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: "تحويل بنكي",
  CARD: "شبكة / مدى",
  CASH: "نقد",
  CHEQUE: "شيك",
  OTHER: "أخرى",
};
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING_REVIEW: "بانتظار المراجعة",
  APPROVED: "معتمدة",
  REJECTED: "مرفوضة",
  REVERSED: "معكوسة",
};
export const PAYMENT_STATUS_COLOR = { PENDING_REVIEW: "amber", APPROVED: "green", REJECTED: "red", REVERSED: "gray" } as const;
export const ADJUSTMENT_TYPE_LABELS = { DISCOUNT: "خصم", WRITE_OFF: "إعفاء", CORRECTION: "تصحيح" } as const;

/** الأقساط القابلة للسداد */
const PAYABLE = ["PENDING", "PARTIAL"] as const;

// ───── أدوات ─────

/** يقفل صفوف الأقساط بترتيب ثابت (يمنع التعارض والجمود) ويعيد المتاح لكل قسط بعد خصم الدفعات المعلقة. */
async function lockSchedules(tx: Tx, scheduleIds: string[], excludePaymentId?: string) {
  const ids = [...new Set(scheduleIds)].sort();
  await tx.$queryRaw`SELECT id FROM payment_schedules WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;
  const rows = await tx.paymentSchedule.findMany({ where: { id: { in: ids } }, include: { contract: { select: { id: true, branchId: true, tenantId: true, status: true, contractNo: true } } } });
  const pending = await tx.paymentAllocation.groupBy({
    by: ["scheduleId"],
    where: { scheduleId: { in: ids }, payment: { status: "PENDING_REVIEW", ...(excludePaymentId ? { id: { not: excludePaymentId } } : {}) } },
    _sum: { amount: true },
  });
  const pend = new Map(pending.map((p) => [p.scheduleId, p._sum.amount ?? new Prisma.Decimal(0)]));
  return new Map(
    rows.map((r) => {
      const remaining = r.amountDue.minus(r.amountPaid).minus(r.amountAdjusted);
      const pendingAmt = pend.get(r.id) ?? new Prisma.Decimal(0);
      return [r.id, { row: r, remaining, pending: pendingAmt, available: remaining.minus(pendingAmt) }];
    }),
  );
}

/**
 * يعيد حساب المسدد وحالة الأقساط من المصدر (توزيعات الدفعات المعتمدة فقط).
 * المسدد قيمة مشتقة مخزنة للسرعة؛ هذه الدالة تضمن ألا تنحرف عن الحقيقة.
 */
export async function recomputeSchedules(tx: Tx | Db, scheduleIds: string[]) {
  if (!scheduleIds.length) return;
  await tx.$executeRaw`
    UPDATE payment_schedules s SET
      amount_paid = sub.paid,
      status = (CASE
        WHEN s.status = 'CANCELLED' THEN 'CANCELLED'
        WHEN sub.paid + s.amount_adjusted >= s.amount_due THEN (CASE WHEN sub.paid = 0 THEN 'WAIVED' ELSE 'PAID' END)
        WHEN sub.paid > 0 OR s.amount_adjusted > 0 THEN 'PARTIAL'
        ELSE 'PENDING' END)::"ScheduleStatus",
      updated_at = now()
    FROM (
      SELECT s2.id, COALESCE(SUM(a.amount) FILTER (WHERE p.status = 'APPROVED'), 0) AS paid
      FROM payment_schedules s2
      LEFT JOIN payment_allocations a ON a.schedule_id = s2.id
      LEFT JOIN payments p ON p.id = a.payment_id
      WHERE s2.id = ANY(${scheduleIds}::uuid[])
      GROUP BY s2.id
    ) sub
    WHERE s.id = sub.id`;
}

async function nextReceiptNo(tx: Tx, branchCode: string, year: string) {
  // قرار معتمد: تسلسل مستقل لكل فرع
  const key = `RECEIPT-${branchCode}-${year}`;
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (key, last_value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING last_value`;
  return `RC-${branchCode}-${year}-${String(rows[0]!.last_value).padStart(5, "0")}`;
}

function mapDbErrors(e: unknown): never {
  const msg = e instanceof Error ? e.message : "";
  if (msg.includes("payments_method_reference_unique") || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target).includes("reference")))
    throw new AppError("DUPLICATE_PAYMENT", "عملية الدفع هذه مسجلة مسبقًا (نفس الوسيلة ورقم المرجع)");
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target).includes("idempotency"))
    throw new AppError("DUPLICATE_SUBMIT", "تم استلام هذا النموذج مسبقًا");
  if (msg.includes("ZAKI_OVERPAYMENT")) throw new AppError("OVERPAYMENT", "مجموع التوزيع يتجاوز مبلغ الدفعة");
  if (msg.includes("schedules_amounts_valid")) throw new AppError("OVERPAYMENT", "المبلغ يتجاوز المتبقي من القسط");
  throw e;
}

// ───── تسجيل دفعة ─────

const recordSchema = z
  .object({
    contractId: z.string().uuid("اختر العقد"),
    amount: decimalString("مبلغ الدفعة"),
    method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "OTHER"], { message: "اختر وسيلة الدفع" }),
    referenceNo: optionalText(80),
    paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ الدفع غير صحيح"),
    notes: optionalText(1000),
    idempotencyKey: z.string().uuid("نموذج غير صالح، أعد تحميل الصفحة"),
    allocations: z
      .array(z.object({ scheduleId: z.string().uuid(), amount: decimalString("مبلغ التوزيع") }))
      .min(1, "اختر قسطًا واحدًا على الأقل ووزّع عليه المبلغ")
      .max(120),
  })
  .refine((d) => !["BANK_TRANSFER", "CHEQUE"].includes(d.method) || !!d.referenceNo, { message: "رقم المرجع مطلوب للتحويل البنكي والشيك", path: ["referenceNo"] });

/**
 * تسجيل دفعة (بانتظار المراجعة). القرارات المعتمدة:
 * - الموظف يختار الأقساط ويوزع المبلغ عليها.
 * - لا دفع زائد: مجموع التوزيع = مبلغ الدفعة، ولا يتجاوز أي توزيع المتبقي المتاح من القسط.
 * لا تُحتسب في المحصّل حتى تُعتمد.
 */
export async function recordPayment(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "payments.record");
  const input = parseInput(recordSchema, raw);
  if (input.paidOn > todayInRiyadh()) throw new AppError("VALIDATION", "تاريخ الدفع لا يمكن أن يكون في المستقبل");
  const contract = await db.contract.findUnique({ where: { id: input.contractId }, select: { id: true, branchId: true, tenantId: true, status: true, contractNo: true } });
  if (!contract) throw new NotFoundError("العقد غير موجود");
  assertBranchAccess(actor, contract.branchId);
  if (!["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"].includes(contract.status)) throw new AppError("STATE", "لا يمكن التحصيل على عقد غير معتمد");

  const amount = money(input.amount);
  const allocTotal = input.allocations.reduce((a, x) => a.plus(money(x.amount)), new Prisma.Decimal(0));
  if (!allocTotal.equals(amount))
    throw new AppError("ALLOCATION_MISMATCH", `مجموع التوزيع (${allocTotal.toFixed(2)}) يجب أن يساوي مبلغ الدفعة (${amount.toFixed(2)}). لا يوجد دفع زائد.`);
  const ids = input.allocations.map((a) => a.scheduleId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", "تكرر قسط في التوزيع");

  try {
    return await db.$transaction(async (tx) => {
      const sched = await lockSchedules(tx, ids);
      for (const a of input.allocations) {
        const s = sched.get(a.scheduleId);
        if (!s || s.row.contractId !== contract.id) throw new AppError("VALIDATION", "أحد الأقساط لا يتبع هذا العقد");
        if (!PAYABLE.includes(s.row.status as (typeof PAYABLE)[number])) throw new AppError("VALIDATION", `القسط ${s.row.seqNo} غير قابل للسداد (${s.row.status === "CANCELLED" ? "ملغى" : "مسدد"})`);
        if (money(a.amount).gt(s.available))
          throw new AppError("OVERPAYMENT", `القسط ${s.row.seqNo}: المتاح للسداد ${s.available.toFixed(2)} ر.س${s.pending.gt(0) ? ` (يوجد ${s.pending.toFixed(2)} بانتظار المراجعة)` : ""}`);
      }
      const p = await tx.payment.create({
        data: {
          tenantId: contract.tenantId,
          contractId: contract.id,
          branchId: contract.branchId,
          amount,
          method: input.method,
          referenceNo: input.referenceNo,
          paidOn: dateOnly(input.paidOn),
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          recordedById: actor.id,
          allocations: { create: input.allocations.map((a) => ({ scheduleId: a.scheduleId, amount: money(a.amount) })) },
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "payment.record",
        entityType: "payment",
        entityId: p.id,
        branchId: p.branchId,
        after: { contractNo: contract.contractNo, amount: amount.toFixed(2), method: p.method, referenceNo: p.referenceNo, paidOn: input.paidOn, allocations: input.allocations },
        meta,
      });
      return p;
    });
  } catch (e) {
    mapDbErrors(e);
  }
}

// ───── المراجعة ─────

async function loadPayment(db: Db | Tx, actor: Actor, id: string) {
  const p = await db.payment.findUnique({ where: { id }, include: { allocations: true, branch: { select: { code: true } } } });
  if (!p) throw new NotFoundError("الدفعة غير موجودة");
  assertBranchAccess(actor, p.branchId);
  return p;
}

/** الاعتماد: يُصدر رقم إيصال من تسلسل الفرع ويحدّث الأقساط — في معاملة واحدة مع قفل الأقساط. */
export async function approvePayment(db: Db, actor: Actor, id: string, meta: RequestMeta = {}) {
  requirePermission(actor, "payments.approve");
  const p = await loadPayment(db, actor, id);
  if (p.status !== "PENDING_REVIEW") throw new AppError("STATE", "الدفعة ليست بانتظار المراجعة");
  try {
    return await db.$transaction(async (tx) => {
      const ids = p.allocations.map((a) => a.scheduleId);
      const sched = await lockSchedules(tx, ids, p.id);
      for (const a of p.allocations) {
        const s = sched.get(a.scheduleId)!;
        if (s.row.status === "CANCELLED") throw new AppError("STATE", `القسط ${s.row.seqNo} أُلغي بعد تسجيل الدفعة؛ ارفضها وسجلها من جديد`);
        if (a.amount.gt(s.remaining)) throw new AppError("OVERPAYMENT", `القسط ${s.row.seqNo} لم يعد يتسع لهذا المبلغ (المتبقي ${s.remaining.toFixed(2)})`);
      }
      const receiptNo = await nextReceiptNo(tx, p.branch.code, todayInRiyadh().slice(0, 4));
      const done = await tx.payment.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { status: "APPROVED", approvedById: actor.id, approvedAt: new Date(), receiptNo } });
      if (done.count !== 1) throw new AppError("STATE", "تمت مراجعة الدفعة بالفعل");
      await recomputeSchedules(tx, ids);
      await writeAudit(tx, { actorId: actor.id, action: "payment.approve", entityType: "payment", entityId: id, branchId: p.branchId, after: { receiptNo, amount: p.amount.toFixed(2) }, meta });
      return tx.payment.findUniqueOrThrow({ where: { id } });
    });
  } catch (e) {
    mapDbErrors(e);
  }
}

export async function rejectPayment(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  requirePermission(actor, "payments.approve");
  const r = parseInput(z.string().trim().min(3, "اذكر سبب الرفض").max(1000), reason);
  const p = await loadPayment(db, actor, id);
  if (p.status !== "PENDING_REVIEW") throw new AppError("STATE", "الدفعة ليست بانتظار المراجعة");
  return db.$transaction(async (tx) => {
    const done = await tx.payment.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { status: "REJECTED", rejectedReason: r, rejectedById: actor.id, rejectedAt: new Date() } });
    if (done.count !== 1) throw new AppError("STATE", "تمت مراجعة الدفعة بالفعل");
    await writeAudit(tx, { actorId: actor.id, action: "payment.reject", entityType: "payment", entityId: id, branchId: p.branchId, after: { reason: r }, meta });
    return tx.payment.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * عكس دفعة معتمدة (تصحيح خطأ أو إعادة مبلغ للعميل): لا تُحذف ولا يُعدّل مبلغها،
 * بل تُعلَّم "معكوسة" وتُستبعد من المسدد والمحصّل، ويبقى الإيصال مسجلًا للتدقيق.
 */
export async function reversePayment(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  requirePermission(actor, "finance.adjust");
  const r = parseInput(z.string().trim().min(5, "اذكر سبب العكس بوضوح").max(1000), reason);
  const p = await loadPayment(db, actor, id);
  if (p.status !== "APPROVED") throw new AppError("STATE", "العكس متاح للدفعات المعتمدة فقط");
  return db.$transaction(async (tx) => {
    const ids = p.allocations.map((a) => a.scheduleId);
    await lockSchedules(tx, ids);
    const done = await tx.payment.updateMany({ where: { id, status: "APPROVED" }, data: { status: "REVERSED", reversedById: actor.id, reversedAt: new Date(), reversalReason: r } });
    if (done.count !== 1) throw new AppError("STATE", "تم تعديل الدفعة بالفعل");
    await recomputeSchedules(tx, ids);
    await writeAudit(tx, { actorId: actor.id, action: "payment.reverse", entityType: "payment", entityId: id, branchId: p.branchId, before: { status: "APPROVED", receiptNo: p.receiptNo }, after: { status: "REVERSED", reason: r }, meta });
    return tx.payment.findUniqueOrThrow({ where: { id } });
  });
}

// ───── التسويات ─────

const adjustmentSchema = z.object({
  scheduleId: z.string().uuid("اختر القسط"),
  // قرار معتمد: لا رسوم تأخير — التسويات تخفض المستحق فقط
  type: z.enum(["DISCOUNT", "WRITE_OFF", "CORRECTION"], { message: "اختر نوع التسوية" }),
  amount: decimalString("مبلغ التسوية"),
  reason: z.string().trim().min(5, "اذكر سبب التسوية بوضوح").max(1000),
});

export async function createAdjustment(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "finance.adjust");
  const input = parseInput(adjustmentSchema, raw);
  const s0 = await db.paymentSchedule.findUnique({ where: { id: input.scheduleId }, include: { contract: { select: { id: true, branchId: true } } } });
  if (!s0) throw new NotFoundError("القسط غير موجود");
  assertBranchAccess(actor, s0.contract.branchId);
  const amount = money(input.amount);
  try {
    return await db.$transaction(async (tx) => {
      const s = (await lockSchedules(tx, [input.scheduleId])).get(input.scheduleId)!;
      if (!PAYABLE.includes(s.row.status as (typeof PAYABLE)[number])) throw new AppError("STATE", "القسط غير مفتوح للتسوية");
      if (amount.gt(s.available)) throw new AppError("VALIDATION", `التسوية تتجاوز المتبقي المتاح (${s.available.toFixed(2)} ر.س)`);
      const adj = await tx.adjustment.create({
        data: { contractId: s.row.contractId, scheduleId: s.row.id, type: input.type, amount, reason: input.reason, createdById: actor.id, approvedById: actor.id, approvedAt: new Date() },
      });
      await tx.paymentSchedule.update({ where: { id: s.row.id }, data: { amountAdjusted: { increment: amount } } });
      await recomputeSchedules(tx, [s.row.id]);
      await writeAudit(tx, { actorId: actor.id, action: "adjustment.create", entityType: "contract", entityId: s.row.contractId, branchId: s0.contract.branchId, after: { seqNo: s.row.seqNo, ...input, amount: amount.toFixed(2) }, meta });
      return adj;
    });
  } catch (e) {
    mapDbErrors(e);
  }
}

// ───── القراءة ─────

export const paymentFiltersSchema = z.object({
  q: z.string().trim().max(80).optional().catch(undefined),
  status: z.enum(["PENDING_REVIEW", "APPROVED", "REJECTED", "REVERSED"]).optional().catch(undefined),
  branchId: z.string().uuid().optional().catch(undefined),
  method: z.enum(["BANK_TRANSFER", "CARD", "CASH", "CHEQUE", "OTHER"]).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10000).optional().catch(undefined),
});
export const PAYMENTS_PAGE_SIZE = 30;

export async function listPayments(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "payments.view");
  const f = paymentFiltersSchema.parse(raw ?? {});
  if (f.branchId) assertBranchAccess(actor, f.branchId);
  const and: Prisma.PaymentWhereInput[] = [branchWhere(actor, "branchId")];
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.status) and.push({ status: f.status });
  if (f.method) and.push({ method: f.method });
  if (f.from) and.push({ paidOn: { gte: dateOnly(f.from) } });
  if (f.to) and.push({ paidOn: { lte: dateOnly(f.to) } });
  if (f.q)
    and.push({
      OR: [
        { receiptNo: { contains: f.q, mode: "insensitive" } },
        { referenceNo: { contains: f.q, mode: "insensitive" } },
        { tenant: { name: { contains: f.q, mode: "insensitive" } } },
        { contract: { contractNo: { contains: f.q, mode: "insensitive" } } },
      ],
    });
  const where = { AND: and };
  const page = f.page ?? 1;
  const [total, sum, payments] = await Promise.all([
    db.payment.count({ where }),
    db.payment.aggregate({ where, _sum: { amount: true } }),
    db.payment.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * PAYMENTS_PAGE_SIZE,
      take: PAYMENTS_PAGE_SIZE,
      include: { tenant: { select: { id: true, name: true } }, branch: { select: { nameAr: true } }, contract: { select: { id: true, contractNo: true } } },
    }),
  ]);
  return { filters: f, page, total, sumAmount: (sum._sum.amount ?? new Prisma.Decimal(0)).toFixed(2), pages: Math.max(1, Math.ceil(total / PAYMENTS_PAGE_SIZE)), payments };
}

export async function getPayment(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "payments.view");
  const p = await db.payment.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true, vatNumber: true, crNumber: true } },
      branch: { select: { nameAr: true, code: true } },
      contract: { select: { id: true, contractNo: true } },
      allocations: { include: { schedule: { select: { seqNo: true, dueDate: true, periodStart: true, periodEnd: true, amountDue: true } } }, orderBy: { schedule: { seqNo: "asc" } } },
    },
  });
  if (!p) throw new NotFoundError("الدفعة غير موجودة");
  assertBranchAccess(actor, p.branchId);
  const ids = [p.recordedById, p.approvedById, p.rejectedById, p.reversedById].filter((x): x is string => !!x);
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  return { payment: p, userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string> };
}

/** الأقساط المفتوحة لعقد مع المتاح للسداد (يُخصم منه المعلق) — لنموذج التسجيل. */
export async function openInstallments(db: Db, actor: Actor, contractId: string) {
  requirePermission(actor, "payments.record");
  const c = await db.contract.findUnique({ where: { id: contractId }, include: { tenant: { select: { name: true } }, branch: { select: { nameAr: true } } } });
  if (!c) throw new NotFoundError("العقد غير موجود");
  assertBranchAccess(actor, c.branchId);
  const rows = await db.paymentSchedule.findMany({ where: { contractId, status: { in: [...PAYABLE] } }, orderBy: { seqNo: "asc" } });
  const pending = await db.paymentAllocation.groupBy({ by: ["scheduleId"], where: { scheduleId: { in: rows.map((r) => r.id) }, payment: { status: "PENDING_REVIEW" } }, _sum: { amount: true } });
  const pend = new Map(pending.map((p) => [p.scheduleId, p._sum.amount ?? new Prisma.Decimal(0)]));
  return {
    contract: c,
    installments: rows.map((r) => {
      const remaining = r.amountDue.minus(r.amountPaid).minus(r.amountAdjusted);
      const pendingAmt = pend.get(r.id) ?? new Prisma.Decimal(0);
      return {
        id: r.id,
        seqNo: r.seqNo,
        dueDate: r.dueDate.toISOString().slice(0, 10),
        amountDue: r.amountDue.toFixed(2),
        paid: r.amountPaid.toFixed(2),
        adjusted: r.amountAdjusted.toFixed(2),
        pending: pendingAmt.toFixed(2),
        available: remaining.minus(pendingAmt).toFixed(2),
      };
    }),
  };
}

/** العقود التي لها أقساط مفتوحة (لاختيار العقد عند تسجيل دفعة). */
export async function contractsWithBalance(db: Db, actor: Actor) {
  requirePermission(actor, "payments.record");
  return db.contract.findMany({
    where: { ...branchWhere(actor, "branchId"), schedules: { some: { status: { in: [...PAYABLE] } } } },
    orderBy: [{ tenant: { name: "asc" } }],
    select: { id: true, contractNo: true, tenant: { select: { name: true } }, branch: { select: { nameAr: true } } },
    take: 2000,
  });
}
