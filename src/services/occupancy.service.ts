import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { dateOnly, todayInRiyadh } from "@/lib/dates";

/** حالات العقد التي تعني أن العقد كان ساريًا فعلًا خلال فترته (لا تشمل المسودة والملغى وبانتظار الاعتماد). */
export const IN_FORCE_STATUSES = ["ACTIVE", "EXPIRED", "RENEWED", "TERMINATED"] as const;

/**
 * حساب الإشغال — تعريفات معتمدة وموحدة لكل النظام (لوحة التحكم، الفروع، التقارير):
 *
 * المخزون القابل للتأجير = الوحدات غير المؤرشفة وحالتها ليست "غير نشطة"، ونوعها يُؤجر بعقود
 *   (وحدات الصيانة تبقى ضمن المخزون لأنها طاقة معطلة مؤقتًا؛ قاعات الاجتماعات خارجه لأنها
 *   تُدار بحجوزات منفصلة بالساعة/اليوم — قرار معتمد).
 * الوحدة "مشغولة" في تاريخ معين = مرتبطة بعقد كان ساريًا فعلًا ويغطي هذا التاريخ
 *   (نشط، أو منتهٍ/مجدد/منهى ضمن فترته الفعلية — المنهى تُقص فترته عند تاريخ الخروج).
 *
 * ثلاث نسب، ويُذكر أساس النسبة دائمًا عند عرضها:
 *  1) حسب عدد الوحدات: الوحدات المشغولة (ولو بمقعد واحد) ÷ عدد الوحدات.
 *  2) حسب المقاعد: الوحدة الحصرية المشغولة = كل سعتها؛ المشتركة = مجموع المقاعد المؤجرة (بحد السعة).
 *  3) حسب المساحة: الحصرية = مساحتها كاملة؛ المشتركة = مساحتها × (المقاعد المؤجرة ÷ السعة).
 *     تُحسب فقط من الوحدات المسجلة مساحتها، ويُعرض عدد الوحدات الناقصة المساحة.
 */
export type OccupancyRow = {
  branchId: string;
  units: number;
  occupiedUnits: number;
  seats: number;
  occupiedSeats: number;
  area: string;
  occupiedArea: string;
  unitsWithoutArea: number;
};

export type OccupancySummary = OccupancyRow & {
  unitsPct: number | null;
  seatsPct: number | null;
  areaPct: number | null;
};

export function pct(part: number | string, whole: number | string): number | null {
  const w = new Prisma.Decimal(whole);
  if (w.lte(0)) return null;
  return new Prisma.Decimal(part).div(w).times(100).toDecimalPlaces(1).toNumber();
}

function summarize(r: OccupancyRow): OccupancySummary {
  return {
    ...r,
    unitsPct: pct(r.occupiedUnits, r.units),
    seatsPct: pct(r.occupiedSeats, r.seats),
    areaPct: pct(r.occupiedArea, r.area),
  };
}

const empty = (branchId: string): OccupancyRow => ({
  branchId,
  units: 0,
  occupiedUnits: 0,
  seats: 0,
  occupiedSeats: 0,
  area: "0.00",
  occupiedArea: "0.00",
  unitsWithoutArea: 0,
});

/**
 * @param branchIds null = كل الفروع (يجب أن يقرر المستدعي ذلك بعد فحص الصلاحيات)
 */
export async function computeOccupancy(db: Db, branchIds: string[] | null, onDate = todayInRiyadh()) {
  const cond =
    branchIds === null
      ? Prisma.sql`TRUE`
      : branchIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`u.branch_id = ANY(${branchIds}::uuid[])`;
  const rows = await db.$queryRaw<
    {
      branch_id: string;
      units: bigint;
      occupied_units: bigint;
      seats: bigint;
      occupied_seats: bigint;
      area: Prisma.Decimal;
      occupied_area: Prisma.Decimal;
      units_without_area: bigint;
    }[]
  >`
    WITH inv AS (
      SELECT u.id, u.branch_id, u.capacity, u.area_sqm, u.occupancy_mode
      FROM units u
      JOIN unit_types ut ON ut.id = u.unit_type_id AND ut.lease_mode = 'LEASE'
      WHERE u.archived_at IS NULL AND u.status <> 'INACTIVE' AND ${cond}
    ),
    occ AS (
      SELECT cu.unit_id, SUM(cu.seats)::int AS seats
      FROM contract_units cu
      JOIN contracts c ON c.id = cu.contract_id
      WHERE c.status IN ('ACTIVE','EXPIRED','RENEWED','TERMINATED') AND ${dateOnly(onDate)}::date BETWEEN cu.start_date AND cu.end_date
      GROUP BY cu.unit_id
    )
    SELECT inv.branch_id,
      COUNT(*) AS units,
      COUNT(occ.unit_id) AS occupied_units,
      COALESCE(SUM(inv.capacity), 0) AS seats,
      COALESCE(SUM(CASE WHEN occ.unit_id IS NULL THEN 0
                        WHEN inv.occupancy_mode = 'EXCLUSIVE' THEN inv.capacity
                        ELSE LEAST(occ.seats, inv.capacity) END), 0) AS occupied_seats,
      COALESCE(SUM(inv.area_sqm), 0)::numeric(14,2) AS area,
      COALESCE(SUM(CASE WHEN occ.unit_id IS NULL OR inv.area_sqm IS NULL THEN 0
                        WHEN inv.occupancy_mode = 'EXCLUSIVE' THEN inv.area_sqm
                        ELSE inv.area_sqm * LEAST(occ.seats, inv.capacity) / inv.capacity END), 0)::numeric(14,2) AS occupied_area,
      COUNT(*) FILTER (WHERE inv.area_sqm IS NULL) AS units_without_area
    FROM inv LEFT JOIN occ ON occ.unit_id = inv.id
    GROUP BY inv.branch_id`;

  const byBranch = new Map<string, OccupancySummary>();
  for (const r of rows) {
    byBranch.set(
      r.branch_id,
      summarize({
        branchId: r.branch_id,
        units: Number(r.units),
        occupiedUnits: Number(r.occupied_units),
        seats: Number(r.seats),
        occupiedSeats: Number(r.occupied_seats),
        area: new Prisma.Decimal(r.area).toFixed(2),
        occupiedArea: new Prisma.Decimal(r.occupied_area).toFixed(2),
        unitsWithoutArea: Number(r.units_without_area),
      }),
    );
  }
  const total = [...byBranch.values()].reduce<OccupancyRow>(
    (a, r) => ({
      branchId: "ALL",
      units: a.units + r.units,
      occupiedUnits: a.occupiedUnits + r.occupiedUnits,
      seats: a.seats + r.seats,
      occupiedSeats: a.occupiedSeats + r.occupiedSeats,
      area: new Prisma.Decimal(a.area).plus(r.area).toFixed(2),
      occupiedArea: new Prisma.Decimal(a.occupiedArea).plus(r.occupiedArea).toFixed(2),
      unitsWithoutArea: a.unitsWithoutArea + r.unitsWithoutArea,
    }),
    empty("ALL"),
  );
  return {
    byBranch,
    total: summarize(total),
    get: (branchId: string) => byBranch.get(branchId) ?? summarize(empty(branchId)),
  };
}

/** المقاعد المشغولة اليوم لكل وحدة (لعرض الحالة الفعلية في القوائم). */
export async function unitOccupancyToday(db: Db, unitIds: string[], onDate = todayInRiyadh()) {
  if (unitIds.length === 0) return new Map<string, number>();
  const rows = await db.$queryRaw<{ unit_id: string; seats: number }[]>`
    SELECT cu.unit_id, SUM(cu.seats)::int AS seats
    FROM contract_units cu JOIN contracts c ON c.id = cu.contract_id
    WHERE c.status IN ('ACTIVE','EXPIRED','RENEWED','TERMINATED') AND cu.unit_id = ANY(${unitIds}::uuid[])
      AND ${dateOnly(onDate)}::date BETWEEN cu.start_date AND cu.end_date
    GROUP BY cu.unit_id`;
  return new Map(rows.map((r) => [r.unit_id, r.seats]));
}

/** هل للوحدة عقود سارية أو مستقبلية تحجزها؟ (يمنع إيقافها/أرشفتها) */
export async function unitHasCurrentOrFutureBookings(db: Db, unitId: string, onDate = todayInRiyadh()) {
  const n = await db.contractUnit.count({
    where: {
      unitId,
      endDate: { gte: dateOnly(onDate) },
      blocksOccupancy: true,
      contract: { status: { in: ["ACTIVE", "PENDING_APPROVAL", "TERMINATED"] } },
    },
  });
  return n > 0;
}
