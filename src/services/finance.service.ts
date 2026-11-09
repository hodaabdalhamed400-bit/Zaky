import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { addDays, addMonthsKeepDay, dateOnly, todayInRiyadh } from "@/lib/dates";

/**
 * التقارير المالية — أربعة مفاهيم مختلفة لا تُخلط (كما طلبت الإدارة):
 * 1) قيمة العقود: إجمالي قيمة العقود النشطة (التزام تعاقدي، وليس نقدًا ولا إيرادًا).
 * 2) المستحقات: أقساط حلّ موعدها ولم تُسدد (المتأخر جزء منها: تجاوز يوم استحقاقه).
 * 3) المحصّل: دفعات معتمدة فقط، حسب تاريخ الدفع، شاملة الضريبة.
 * 4) الإيراد المحاسبي (تقديري): صافي الإيجار بدون ضريبة موزعًا على أيام فترة كل قسط،
 *    بغض النظر عن السداد. للمراجعة من المحاسب — النظام ليس نظامًا محاسبيًا معتمدًا.
 */
const D = (v: Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);

function scope(actor: Actor, branchId?: string): string[] | null {
  if (branchId) {
    assertBranchAccess(actor, branchId);
    return [branchId];
  }
  return actor.allBranches ? null : [...actor.branchIds];
}
const cond = (ids: string[] | null, col: string) =>
  ids === null ? Prisma.sql`TRUE` : ids.length === 0 ? Prisma.sql`FALSE` : Prisma.sql`${Prisma.raw(col)} = ANY(${ids}::uuid[])`;

export function monthRange(ym: string) {
  const start = `${ym}-01`;
  const end = addDays(addMonthsKeepDay(start, 1), -1);
  return { start, end };
}

export const financeFiltersSchema = z.object({
  branchId: z.string().uuid().optional().catch(undefined),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().catch(undefined),
});

export async function getFinanceSummary(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "payments.view");
  const f = financeFiltersSchema.parse(raw ?? {});
  const ids = scope(actor, f.branchId);
  const today = todayInRiyadh();
  const month = f.month ?? today.slice(0, 7);
  const cur = monthRange(month);
  const prev = monthRange(addMonthsKeepDay(cur.start, -1).slice(0, 7));
  const lastYear = monthRange(addMonthsKeepDay(cur.start, -12).slice(0, 7));
  const T = dateOnly(today);

  const collected = async (r: { start: string; end: string }) => {
    const x = await db.$queryRaw<{ s: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(amount), 0) AS s FROM payments p
      WHERE p.status = 'APPROVED' AND p.paid_on BETWEEN ${dateOnly(r.start)}::date AND ${dateOnly(r.end)}::date AND ${cond(ids, "p.branch_id")}`;
    return D(x[0]?.s);
  };

  const [totals, cCur, cPrev, cLy, pending, revenue, byBranch, byMonth] = await Promise.all([
    db.$queryRaw<{ value: Prisma.Decimal; due: Prisma.Decimal; overdue: Prisma.Decimal; future: Prisma.Decimal; adjusted: Prisma.Decimal }[]>`
      SELECT
        (SELECT COALESCE(SUM(total_amount), 0) FROM contracts c WHERE c.status = 'ACTIVE' AND ${cond(ids, "c.branch_id")}) AS value,
        COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FILTER (WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date <= ${T}::date), 0) AS due,
        COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FILTER (WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date < ${T}::date), 0) AS overdue,
        COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FILTER (WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date > ${T}::date), 0) AS future,
        COALESCE(SUM(s.amount_adjusted), 0) AS adjusted
      FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
      WHERE ${cond(ids, "c.branch_id")}`,
    collected(cur),
    collected(prev),
    collected(lastYear),
    db.$queryRaw<{ n: bigint; s: Prisma.Decimal }[]>`
      SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS s FROM payments p WHERE p.status = 'PENDING_REVIEW' AND ${cond(ids, "p.branch_id")}`,
    db.$queryRaw<{ s: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(
        s.net_amount * ((LEAST(s.period_end, ${dateOnly(cur.end)}::date) - GREATEST(s.period_start, ${dateOnly(cur.start)}::date) + 1)::numeric
        / (s.period_end - s.period_start + 1)::numeric)
      ), 0)::numeric(14,2) AS s
      FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
      WHERE s.status <> 'CANCELLED' AND s.period_start <= ${dateOnly(cur.end)}::date AND s.period_end >= ${dateOnly(cur.start)}::date
        AND ${cond(ids, "c.branch_id")}`,
    db.$queryRaw<{ id: string; name: string; due: Prisma.Decimal; overdue: Prisma.Decimal; future: Prisma.Decimal; collected: Prisma.Decimal; value: Prisma.Decimal }[]>`
      SELECT b.id, b.name_ar AS name,
        COALESCE((SELECT SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
                  WHERE c.branch_id = b.id AND s.status IN ('PENDING','PARTIAL') AND s.due_date <= ${T}::date), 0) AS due,
        COALESCE((SELECT SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
                  WHERE c.branch_id = b.id AND s.status IN ('PENDING','PARTIAL') AND s.due_date < ${T}::date), 0) AS overdue,
        COALESCE((SELECT SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
                  WHERE c.branch_id = b.id AND s.status IN ('PENDING','PARTIAL') AND s.due_date > ${T}::date), 0) AS future,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.branch_id = b.id AND p.status = 'APPROVED'
                  AND p.paid_on BETWEEN ${dateOnly(cur.start)}::date AND ${dateOnly(cur.end)}::date), 0) AS collected,
        COALESCE((SELECT SUM(c.total_amount) FROM contracts c WHERE c.branch_id = b.id AND c.status = 'ACTIVE'), 0) AS value
      FROM branches b WHERE b.status <> 'INACTIVE' AND ${cond(ids, "b.id")}
      ORDER BY name`,
    db.$queryRaw<{ m: string; billed: Prisma.Decimal; collected: Prisma.Decimal }[]>`
      WITH months AS (
        SELECT to_char(d, 'YYYY-MM') AS m, d::date AS ms, (d + interval '1 month - 1 day')::date AS me
        FROM generate_series(${dateOnly(addMonthsKeepDay(cur.start, -11))}::date, ${dateOnly(cur.start)}::date, interval '1 month') d
      )
      SELECT months.m,
        COALESCE((SELECT SUM(s.amount_due) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
                  WHERE s.status <> 'CANCELLED' AND s.due_date BETWEEN months.ms AND months.me AND ${cond(ids, "c.branch_id")}), 0) AS billed,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.status = 'APPROVED'
                  AND p.paid_on BETWEEN months.ms AND months.me AND ${cond(ids, "p.branch_id")}), 0) AS collected
      FROM months ORDER BY months.m`,
  ]);
  const t = totals[0]!;
  return {
    filters: { ...f, month },
    range: cur,
    contractValue: D(t.value),
    due: D(t.due),
    overdue: D(t.overdue),
    future: D(t.future),
    adjusted: D(t.adjusted),
    collected: { current: cCur, previous: cPrev, lastYear: cLy },
    pending: { count: Number(pending[0]?.n ?? 0), amount: D(pending[0]?.s) },
    revenueNet: D(revenue[0]?.s),
    byBranch: byBranch.map((r) => ({ id: r.id, name: r.name, due: D(r.due), overdue: D(r.overdue), future: D(r.future), collected: D(r.collected), value: D(r.value) })),
    byMonth: byMonth.map((r) => ({ month: r.m, billed: D(r.billed), collected: D(r.collected) })),
  };
}

/** تقرير المتأخرات: لكل عقد مبلغ المتأخر وأقدم استحقاق وعدد أيام التأخير. */
export async function overdueReport(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "payments.view");
  const f = financeFiltersSchema.parse(raw ?? {});
  const ids = scope(actor, f.branchId);
  const T = dateOnly(todayInRiyadh());
  const rows = await db.$queryRaw<
    { contract_id: string; contract_no: string; tenant_id: string; tenant: string; mobile: string | null; branch: string; overdue: Prisma.Decimal; oldest: Date; installments: bigint }[]
  >`
    SELECT c.id AS contract_id, c.contract_no, t.id AS tenant_id, t.name AS tenant, t.mobile, b.name_ar AS branch,
      SUM(s.amount_due - s.amount_paid - s.amount_adjusted) AS overdue, MIN(s.due_date) AS oldest, COUNT(*) AS installments
    FROM payment_schedules s
    JOIN contracts c ON c.id = s.contract_id
    JOIN tenants t ON t.id = c.tenant_id
    JOIN branches b ON b.id = c.branch_id
    WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date < ${T}::date AND ${cond(ids, "c.branch_id")}
    GROUP BY c.id, c.contract_no, t.id, t.name, t.mobile, b.name_ar
    ORDER BY MIN(s.due_date) ASC`;
  const today = new Date(`${todayInRiyadh()}T00:00:00Z`).getTime();
  return rows.map((r) => ({
    contractId: r.contract_id,
    contractNo: r.contract_no,
    tenantId: r.tenant_id,
    tenant: r.tenant,
    mobile: r.mobile,
    branch: r.branch,
    overdue: D(r.overdue),
    oldestDue: r.oldest,
    daysLate: Math.round((today - r.oldest.getTime()) / 86_400_000),
    installments: Number(r.installments),
  }));
}
