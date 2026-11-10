import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { requirePermission, assertBranchAccess } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh, addDays } from "@/lib/dates";
import { computeOccupancy, IN_FORCE_STATUSES } from "./occupancy.service";

/**
 * مؤشرات لوحة التحكم — تُحسب من قاعدة البيانات مباشرة ومقيدة بفروع المستخدم.
 * التعريفات (موثقة في docs/BUSINESS_RULES.md):
 * - الإشغال: نفس تعريفات occupancy.service.ts (الوحدات / المقاعد / المساحة).
 * - المتاحة = حالتها "متاحة" وليس عليها عقد نشط اليوم.
 * - المستحق = الأقساط التي حلّ تاريخها (حتى اليوم) ولم تُسدد بالكامل.
 * - المتأخر = الأقساط التي تجاوزت تاريخ استحقاقها ولم تُسدد بالكامل.
 * - المحصّل = الدفعات المعتمدة فقط خلال الشهر الحالي (بتوقيت الرياض).
 */
export type DashboardStats = {
  branches: number;
  preparingBranches: number;
  units: number;
  rentedUnits: number;
  availableUnits: number;
  occupancyPct: number | null;
  seatsOccupancyPct: number | null;
  areaOccupancyPct: number | null;
  activeContracts: number;
  expiringContracts: number;
  dueAmount: string;
  collectedThisMonth: string;
  overdueAmount: string;
  expiringWithinDays: number;
};

export async function getDashboardStats(db: Db, actor: Actor, opts: { branchId?: string } = {}): Promise<DashboardStats> {
  requirePermission(actor, "dashboard.view");
  if (opts.branchId) assertBranchAccess(actor, opts.branchId);

  const branchIds: string[] | null = opts.branchId ? [opts.branchId] : actor.allBranches ? null : [...actor.branchIds];
  const today = todayInRiyadh();
  const expiringWithinDays = 30;
  const monthStart = `${today.slice(0, 7)}-01`;

  // تقييد الفروع داخل SQL الخام عبر معاملات آمنة (لا يوجد دمج نصي لمدخلات المستخدم)
  const branchCond = (col: string) =>
    branchIds === null
      ? Prisma.sql`TRUE`
      : branchIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`${Prisma.raw(col)} = ANY(${branchIds}::uuid[])`;

  const branchWhere = branchIds === null ? {} : { id: { in: branchIds } };
  const scoped = branchIds === null ? {} : { branchId: { in: branchIds } };

  const [branches, preparingBranches, occ, available, activeContracts, expiring, money] = await Promise.all([
    db.branch.count({ where: { status: "ACTIVE", ...branchWhere } }),
    db.branch.count({ where: { status: "PREPARING", ...branchWhere } }),
    computeOccupancy(db, branchIds, today),
    db.unit.count({
      where: {
        archivedAt: null,
        status: "AVAILABLE",
        unitType: { leaseMode: "LEASE" },
        ...scoped,
        NOT: { contractUnits: { some: { contract: { status: { in: [...IN_FORCE_STATUSES] } }, startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } } } },
      },
    }),
    db.contract.count({ where: { status: "ACTIVE", ...scoped } }),
    db.contract.count({
      where: {
        status: "ACTIVE",
        endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, expiringWithinDays)) },
        ...scoped,
      },
    }),
    db.$queryRaw<{ due: Prisma.Decimal | null; overdue: Prisma.Decimal | null; collected: Prisma.Decimal | null }[]>`
      SELECT
        (SELECT COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted), 0)
           FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
          WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date <= ${dateOnly(today)}::date
            AND ${branchCond("c.branch_id")}) AS due,
        (SELECT COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted), 0)
           FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
          WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date < ${dateOnly(today)}::date
            AND ${branchCond("c.branch_id")}) AS overdue,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
          WHERE p.status = 'APPROVED' AND p.paid_on >= ${dateOnly(monthStart)}::date
            AND p.paid_on <= ${dateOnly(today)}::date
            AND ${branchCond("p.branch_id")}) AS collected`,
  ]);

  const m = money[0];
  return {
    branches,
    preparingBranches,
    units: occ.total.units,
    rentedUnits: occ.total.occupiedUnits,
    availableUnits: available,
    occupancyPct: occ.total.unitsPct,
    seatsOccupancyPct: occ.total.seatsPct,
    areaOccupancyPct: occ.total.unitsWithoutArea === 0 ? occ.total.areaPct : null,
    activeContracts,
    expiringContracts: expiring,
    dueAmount: new Prisma.Decimal(m?.due ?? 0).toFixed(2),
    overdueAmount: new Prisma.Decimal(m?.overdue ?? 0).toFixed(2),
    collectedThisMonth: new Prisma.Decimal(m?.collected ?? 0).toFixed(2),
    expiringWithinDays,
  };
}

// ───── بيانات الرسوم البيانية ─────

export type ChartsData = {
  months: string[];
  occupancyByBranch: { name: string; unitsPct: number | null; seatsPct: number | null; units: number }[];
  occupancyTrend: { month: string; unitsPct: number | null; seatsPct: number | null }[];
  contractsFlow: { month: string; started: number; ended: number }[];
  money: { month: string; billed: number; collected: number }[] | null;
};

function monthEnds(today: string, count: number) {
  const out: { month: string; start: string; end: string; at: string }[] = [];
  const first = `${today.slice(0, 7)}-01`;
  for (let i = count - 1; i >= 0; i--) {
    const start = addMonthsKeepDayLocal(first, -i);
    const end = addDays(addMonthsKeepDayLocal(start, 1), -1);
    out.push({ month: start.slice(0, 7), start, end, at: end < today ? end : today });
  }
  return out;
}
function addMonthsKeepDayLocal(ymd: string, n: number) {
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * - الإشغال حسب الفرع: اليوم، حسب الوحدات والمقاعد.
 * - تطور الإشغال: في آخر يوم من كل شهر (أو اليوم للشهر الحالي).
 * - العقود الجديدة: عقود سرت فعلًا وبدأت في الشهر. المنتهية: انتهت أو أُنهيت أو جُددت في الشهر.
 * - المستحق مقابل المحصّل: أقساط استحقت في الشهر مقابل دفعات معتمدة في الشهر (لمن يملك payments.view).
 */
export async function getDashboardCharts(db: Db, actor: Actor, opts: { branchId?: string; months?: number } = {}): Promise<ChartsData> {
  requirePermission(actor, "dashboard.view");
  if (opts.branchId) assertBranchAccess(actor, opts.branchId);
  const branchIds: string[] | null = opts.branchId ? [opts.branchId] : actor.allBranches ? null : [...actor.branchIds];
  const count = [6, 12, 24].includes(opts.months ?? 12) ? (opts.months ?? 12) : 12;
  const today = todayInRiyadh();
  const ms = monthEnds(today, count);
  const cond = (col: string) =>
    branchIds === null ? Prisma.sql`TRUE` : branchIds.length === 0 ? Prisma.sql`FALSE` : Prisma.sql`${Prisma.raw(col)} = ANY(${branchIds}::uuid[])`;

  const branches = await db.branch.findMany({
    where: { status: { not: "INACTIVE" }, ...(branchIds === null ? {} : { id: { in: branchIds } }) },
    orderBy: { nameAr: "asc" },
    select: { id: true, nameAr: true },
  });
  const [now, trend, flow, money] = await Promise.all([
    computeOccupancy(db, branches.map((b) => b.id), today),
    Promise.all(ms.map((m) => computeOccupancy(db, branchIds, m.at).then((o) => ({ month: m.month, unitsPct: o.total.unitsPct, seatsPct: o.total.seatsPct })))),
    db.$queryRaw<{ m: string; started: bigint; ended: bigint }[]>`
      WITH months AS (SELECT to_char(d, 'YYYY-MM') AS m, d::date AS ms, (d + interval '1 month - 1 day')::date AS me
        FROM generate_series(${dateOnly(ms[0]!.start)}::date, ${dateOnly(ms[ms.length - 1]!.start)}::date, interval '1 month') d)
      SELECT months.m,
        (SELECT COUNT(*) FROM contracts c WHERE c.status IN ('ACTIVE','EXPIRED','RENEWED','TERMINATED')
           AND c.start_date BETWEEN months.ms AND months.me AND ${cond("c.branch_id")}) AS started,
        (SELECT COUNT(*) FROM contracts c WHERE c.status IN ('EXPIRED','RENEWED','TERMINATED')
           AND COALESCE(c.ended_at, c.end_date) BETWEEN months.ms AND months.me AND ${cond("c.branch_id")}) AS ended
      FROM months ORDER BY months.m`,
    actor.permissions.has("payments.view")
      ? db.$queryRaw<{ m: string; billed: Prisma.Decimal; collected: Prisma.Decimal }[]>`
          WITH months AS (SELECT to_char(d, 'YYYY-MM') AS m, d::date AS ms, (d + interval '1 month - 1 day')::date AS me
            FROM generate_series(${dateOnly(ms[0]!.start)}::date, ${dateOnly(ms[ms.length - 1]!.start)}::date, interval '1 month') d)
          SELECT months.m,
            COALESCE((SELECT SUM(s.amount_due) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
              WHERE s.status <> 'CANCELLED' AND s.due_date BETWEEN months.ms AND months.me AND ${cond("c.branch_id")}), 0) AS billed,
            COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.status = 'APPROVED'
              AND p.paid_on BETWEEN months.ms AND months.me AND ${cond("p.branch_id")}), 0) AS collected
          FROM months ORDER BY months.m`
      : Promise.resolve(null),
  ]);
  return {
    months: ms.map((m) => m.month),
    occupancyByBranch: branches.map((b) => {
      const o = now.get(b.id);
      return { name: b.nameAr, unitsPct: o.unitsPct, seatsPct: o.seatsPct, units: o.units };
    }),
    occupancyTrend: trend,
    contractsFlow: flow.map((r) => ({ month: r.m, started: Number(r.started), ended: Number(r.ended) })),
    // للرسم فقط (أرقام عادية بعد التقريب لمنزلتين)؛ الأرقام الرسمية في الجداول والتقارير
    money: money ? money.map((r) => ({ month: r.m, billed: Number(new Prisma.Decimal(r.billed).toFixed(2)), collected: Number(new Prisma.Decimal(r.collected).toFixed(2)) })) : null,
  };
}
