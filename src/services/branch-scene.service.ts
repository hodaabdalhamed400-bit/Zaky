import { z } from "zod";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh } from "@/lib/dates";
import { parseInput } from "@/lib/validation";
import { IN_FORCE_STATUSES, unitOccupancyToday } from "./occupancy.service";
import { PRICING_CYCLE_LABELS, effectiveUnitStatus } from "./units.service";

/**
 * مشهد الفرع ثلاثي الأبعاد: مكان كل وحدة (بالأمتار) + حالتها الحية.
 * الوحدة بلا مكان محفوظ تُرتب تلقائيًا بجانب الموضوعة، فيعمل المجسم من أول يوم.
 */

export type SceneTone = "available" | "rented" | "partial" | "expiring" | "reserved" | "maintenance" | "inactive";

export type SceneUnit = {
  id: string;
  code: string;
  typeKey: string;
  typeName: string;
  floorId: string | null;
  x: number;
  y: number;
  w: number;
  d: number;
  placed: boolean;
  tone: SceneTone;
  statusLabel: string;
  capacity: number;
  occupiedSeats: number;
  tenants: string[];
  until: string | null;
  daysLeft: number | null;
  price: string;
  cycle: string;
  bookedNow: boolean;
  areaSqm: number | null;
};

export type SceneFloor = { id: string | null; name: string; level: number; units: SceneUnit[] };

const EXPIRING_DAYS = 30;
const ROW_WIDTH = 30; // عرض صف الترتيب التلقائي بالأمتار
const GAP = 1.5;

/** المقاس الافتراضي للوحدة (عرض × عمق بالأمتار) من مساحتها أو نوعها وسعتها */
export function defaultSize(u: { typeKey: string; capacity: number; areaSqm: number | null }): { w: number; d: number } {
  const round = (n: number) => Math.round(n * 2) / 2;
  if (u.areaSqm && u.areaSqm >= 2) {
    const w = Math.sqrt(u.areaSqm * 1.25);
    return { w: Math.min(30, Math.max(2, round(w))), d: Math.min(30, Math.max(2, round(u.areaSqm / w))) };
  }
  switch (u.typeKey) {
    case "MEETING_ROOM":
      return { w: u.capacity > 10 ? 8 : 6, d: 4.5 };
    case "SHARED_OFFICE": {
      const area = Math.max(16, u.capacity * 3.2);
      const w = round(Math.sqrt(area * 1.6));
      return { w: Math.min(20, w), d: Math.min(16, round(area / w)) };
    }
    case "ADMIN_SPACE":
      return { w: 5, d: 4 };
    default:
      return { w: u.capacity > 3 ? 5 : 4, d: u.capacity > 3 ? 4.5 : 3.5 };
  }
}

/** ترتيب تلقائي: الوحدات غير الموضوعة تُصف في صفوف بعد آخر وحدة موضوعة، بلا تداخل */
export function autoLayout<T extends { x: number; y: number; w: number; d: number; placed: boolean }>(units: T[]): T[] {
  const placed = units.filter((u) => u.placed);
  let y = placed.length ? Math.max(...placed.map((u) => u.y + u.d)) + GAP * 2 : 0;
  let x = 0;
  let rowDepth = 0;
  return units.map((u) => {
    if (u.placed) return u;
    if (x > 0 && x + u.w > ROW_WIDTH) {
      y += rowDepth + GAP * 1.5; // ممر بين الصفوف
      x = 0;
      rowDepth = 0;
    }
    const out = { ...u, x, y };
    x += u.w + GAP;
    rowDepth = Math.max(rowDepth, u.d);
    return out;
  });
}

function nowHourRiyadh() {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }).format(new Date()));
}

export async function getBranchScene(db: Db, actor: Actor, branchId: string) {
  requirePermission(actor, "units.view");
  assertBranchAccess(actor, branchId);
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { id: true, nameAr: true, code: true, city: true, status: true } });
  if (!branch) throw new NotFoundError("الفرع غير موجود");
  const today = todayInRiyadh();
  const T = dateOnly(today);
  const [floors, units] = await Promise.all([
    db.floor.findMany({ where: { branchId }, orderBy: [{ level: "asc" }, { name: "asc" }], select: { id: true, name: true, level: true } }),
    db.unit.findMany({
      where: { branchId, archivedAt: null },
      orderBy: { code: "asc" },
      include: { unitType: { select: { key: true, nameAr: true } } },
    }),
  ]);
  const ids = units.map((u) => u.id);
  const hour = nowHourRiyadh();
  const [occ, current, booked] = await Promise.all([
    unitOccupancyToday(db, ids, today),
    db.contractUnit.findMany({
      where: { unitId: { in: ids }, contract: { status: { in: [...IN_FORCE_STATUSES] } }, startDate: { lte: T }, endDate: { gte: T } },
      select: { unitId: true, endDate: true, contract: { select: { tenant: { select: { name: true } } } } },
      orderBy: { endDate: "asc" },
    }),
    db.roomBooking.findMany({
      where: { unitId: { in: ids }, bookingDate: T, status: "CONFIRMED", startHour: { lte: hour }, endHour: { gt: hour } },
      select: { unitId: true },
    }),
  ]);
  const bookedNow = new Set(booked.map((b) => b.unitId));
  const todayMs = T.getTime();

  const sceneUnits: SceneUnit[] = units.map((u) => {
    const seats = occ.get(u.id) ?? 0;
    const st = effectiveUnitStatus(u, seats);
    const cur = current.filter((c) => c.unitId === u.id);
    const until = cur[0]?.endDate ?? null;
    const daysLeft = until ? Math.round((until.getTime() - todayMs) / 86_400_000) : null;
    const tone: SceneTone =
      st.key === "OCCUPIED" || st.key === "RENTED"
        ? daysLeft !== null && daysLeft <= EXPIRING_DAYS
          ? "expiring"
          : "rented"
        : st.key === "PARTIAL"
          ? "partial"
          : st.key === "AVAILABLE"
            ? "available"
            : st.key === "RESERVED"
              ? "reserved"
              : st.key === "MAINTENANCE"
                ? "maintenance"
                : "inactive";
    const area = u.areaSqm ? Number(u.areaSqm) : null;
    const placed = u.layoutX !== null && u.layoutY !== null && u.layoutW !== null && u.layoutD !== null;
    const size = placed ? { w: Number(u.layoutW), d: Number(u.layoutD) } : defaultSize({ typeKey: u.unitType.key, capacity: u.capacity, areaSqm: area });
    return {
      id: u.id,
      code: u.code,
      typeKey: u.unitType.key,
      typeName: u.unitType.nameAr,
      floorId: u.floorId,
      x: placed ? Number(u.layoutX) : 0,
      y: placed ? Number(u.layoutY) : 0,
      w: size.w,
      d: size.d,
      placed,
      tone,
      statusLabel: st.label,
      capacity: u.capacity,
      occupiedSeats: seats,
      tenants: [...new Set(cur.map((c) => c.contract.tenant.name))],
      until: until ? until.toISOString().slice(0, 10) : null,
      daysLeft,
      price: u.basePrice.toFixed(2),
      cycle: PRICING_CYCLE_LABELS[u.pricingCycle],
      bookedNow: bookedNow.has(u.id),
      areaSqm: area,
    };
  });

  // الطوابق: المعرّفة + «بدون دور» للوحدات غير المرتبطة بدور
  const groups: SceneFloor[] = floors.map((f) => ({ id: f.id, name: f.name, level: f.level, units: [] }));
  const loose: SceneFloor = { id: null, name: floors.length ? "بدون دور محدد" : "الفرع", level: floors.length ? (floors.at(-1)!.level + 1) : 0, units: [] };
  for (const su of sceneUnits) (groups.find((g) => g.id === su.floorId) ?? loose).units.push(su);
  const all = [...groups, ...(loose.units.length ? [loose] : [])]
    .filter((g) => g.units.length > 0 || groups.length === 0)
    .map((g) => ({ ...g, units: autoLayout(g.units) }));

  const counts = sceneUnits.reduce<Record<SceneTone, number>>(
    (a, u) => ({ ...a, [u.tone]: a[u.tone] + 1 }),
    { available: 0, rented: 0, partial: 0, expiring: 0, reserved: 0, maintenance: 0, inactive: 0 },
  );
  return { branch, floors: all, counts, total: sceneUnits.length, placedCount: sceneUnits.filter((u) => u.placed).length };
}

const num = (min: number, max: number) => z.coerce.number().finite().min(min).max(max).transform((v) => Math.round(v * 100) / 100);
const layoutSchema = z
  .array(
    z.object({
      unitId: z.string().uuid(),
      x: num(0, 500),
      y: num(0, 500),
      w: num(1, 100),
      d: num(1, 100),
    }),
  )
  .max(1000);

/** حفظ مخطط الفرع (أماكن ومقاسات الوحدات). الوحدات غير المذكورة لا تتغير. */
export async function saveBranchLayout(db: Db, actor: Actor, branchId: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  assertBranchAccess(actor, branchId);
  const items = parseInput(layoutSchema, raw);
  if (new Set(items.map((i) => i.unitId)).size !== items.length) throw new AppError("VALIDATION", "وحدة مكررة في المخطط");
  const owned = await db.unit.count({ where: { id: { in: items.map((i) => i.unitId) }, branchId, archivedAt: null } });
  if (owned !== items.length) throw new AppError("VALIDATION", "المخطط يحتوي وحدات لا تتبع هذا الفرع");
  await db.$transaction(async (tx) => {
    for (const i of items) {
      await tx.unit.update({ where: { id: i.unitId }, data: { layoutX: i.x, layoutY: i.y, layoutW: i.w, layoutD: i.d } });
    }
    await writeAudit(tx, { actorId: actor.id, action: "unit.layout_update", entityType: "branch", entityId: branchId, branchId, after: { units: items.length }, meta });
  });
  return { saved: items.length };
}

/** إعادة وحدات الفرع للترتيب التلقائي */
export async function resetBranchLayout(db: Db, actor: Actor, branchId: string, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  assertBranchAccess(actor, branchId);
  return db.$transaction(async (tx) => {
    const r = await tx.unit.updateMany({ where: { branchId }, data: { layoutX: null, layoutY: null, layoutW: null, layoutD: null } });
    await writeAudit(tx, { actorId: actor.id, action: "unit.layout_reset", entityType: "branch", entityId: branchId, branchId, after: { units: r.count }, meta });
    return r.count;
  });
}
