import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { requirePermission, assertBranchAccess } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh, addDays } from "@/lib/dates";
import { computeOccupancy } from "./occupancy.service";

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
        ...scoped,
        NOT: { contractUnits: { some: { contract: { status: "ACTIVE" }, startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } } } },
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
