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
import { BRANCH_PLANS } from "@/lib/branch-plans";

/**
 * مشهد الفرع ثلاثي الأبعاد: مكان كل وحدة (بالأمتار) + حالتها الحية.
 * الوحدة بلا مكان محفوظ تُرتب تلقائيًا بجانب الموضوعة، فيعمل المجسم من أول يوم.
 */

export type SceneTone = "available" | "rented" | "partial" | "expiring" | "reserved" | "maintenance" | "inactive" | "unregistered" | "facility";

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
  /** له مكان (محفوظ، أو من المخطط الجاهز، أو مرتب تلقائيًا بعد autoLayout) */
  placed: boolean;
  /** المكان محفوظ يدويًا من محرر المخطط */
  saved: boolean;
  /** unit = وحدة مسجلة، plan = غرفة في المخطط الجاهز غير مسجلة بعد، facility = مرافق */
  kind: "unit" | "plan" | "facility";
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
const PLAN_TYPE_NAMES: Record<string, string> = { PRIVATE_OFFICE: "مكتب خاص", SHARED_OFFICE: "مكتب مشترك", MEETING_ROOM: "قاعة اجتماعات", ADMIN_SPACE: "مساحة إدارية", FACILITY: "مرافق" };
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

/** رقم الدور من اسمه (الأرضي=0، الأول=1…، القبو=-1) لمطابقة أدوار المخطط مع أدوار الفرع */
export function floorKey(name: string): number | null {
  const n = name.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").trim().toLowerCase();
  if (/قبو|بدروم|basement/.test(n)) return -1;
  if (/ارضي|ground|^g$/.test(n)) return 0;
  if (/اول|first|^1$/.test(n)) return 1;
  if (/ثاني|second|^2$/.test(n)) return 2;
  if (/ثالث|third|^3$/.test(n)) return 3;
  if (/رابع|fourth|^4$/.test(n)) return 4;
  return null;
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
  // المخطط الجاهز للفرع (إن وُجد): يحدد أماكن الوحدات غير المرسومة، ويعرض الغرف غير المسجلة بعد
  const plan = BRANCH_PLANS[branch.code] ?? [];
  const usedPlan = new Set<string>();
  // المخططات متعددة الأدوار: كل غرفة في دورها. يُطابَق الدور مع أدوار الفرع المسجلة (الأرضي/الأول…)،
  // وإن لم يكن مسجلًا يُعرض دور من المخطط نفسه حتى تُضاف الأدوار في النظام
  const planFloorIds = new Map<string, string>();
  const virtualFloors: { id: string; name: string; level: number }[] = [];
  [...new Set(plan.map((p) => p.floor).filter((x): x is string => !!x))].forEach((name, i) => {
    const key = floorKey(name);
    const match = floors.find((f) => (key !== null && floorKey(f.name) === key) || f.name.trim() === name.trim());
    if (match) planFloorIds.set(name, match.id);
    else {
      const id = `plan-floor:${name}`;
      virtualFloors.push({ id, name, level: key ?? 100 + i });
      planFloorIds.set(name, id);
    }
  });
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
    const saved = u.layoutX !== null && u.layoutY !== null && u.layoutW !== null && u.layoutD !== null;
    const fromPlan = !saved ? plan.find((p) => p.code === u.code && p.type !== "FACILITY") : undefined;
    if (fromPlan) usedPlan.add(fromPlan.code);
    const placed = saved || !!fromPlan;
    const size = saved ? { w: Number(u.layoutW), d: Number(u.layoutD) } : fromPlan ? { w: fromPlan.w, d: fromPlan.d } : defaultSize({ typeKey: u.unitType.key, capacity: u.capacity, areaSqm: area });
    return {
      id: u.id,
      code: u.code,
      typeKey: u.unitType.key,
      typeName: u.unitType.nameAr,
      floorId: u.floorId ?? (fromPlan?.floor ? (planFloorIds.get(fromPlan.floor) ?? null) : null),
      x: saved ? Number(u.layoutX) : (fromPlan?.x ?? 0),
      y: saved ? Number(u.layoutY) : (fromPlan?.y ?? 0),
      w: size.w,
      d: size.d,
      placed,
      saved,
      kind: "unit",
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

  const registeredCodes = new Set(units.map((u) => u.code));
  const ghosts: SceneUnit[] = plan
    .filter((p) => p.type === "FACILITY" || !registeredCodes.has(p.code))
    .map((p) => ({
      id: `plan:${p.code}`,
      code: p.type === "FACILITY" ? (p.label ?? p.code) : p.code,
      typeKey: p.facility === "coffee" ? "COFFEE" : p.facility === "parking" ? "PARKING" : p.type,
      typeName: p.facility === "coffee" ? "ركن القهوة" : p.facility === "parking" ? "باركينج" : (PLAN_TYPE_NAMES[p.type] ?? p.type),
      floorId: p.floor ? (planFloorIds.get(p.floor) ?? null) : null,
      x: p.x,
      y: p.y,
      w: p.w,
      d: p.d,
      placed: true,
      saved: false,
      kind: p.type === "FACILITY" ? "facility" : "plan",
      tone: p.type === "FACILITY" ? "facility" : "unregistered",
      statusLabel: p.type === "FACILITY" ? "مرافق" : "غير مسجلة في النظام",
      capacity: p.capacity,
      occupiedSeats: 0,
      tenants: [],
      until: null,
      daysLeft: null,
      price: "0.00",
      cycle: "",
      bookedNow: false,
      areaSqm: Math.round(p.w * p.d * 10) / 10,
    }));
  // الغرف غير المسجلة تُعرض في الدور الذي فيه أغلب وحدات المخطط (أو «الفرع» إن لم توجد أدوار)
  const planFloorId = (() => {
    const tally = new Map<string | null, number>();
    for (const su of sceneUnits) if (usedPlan.has(su.code)) tally.set(su.floorId, (tally.get(su.floorId) ?? 0) + 1);
    return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  for (const g of ghosts) if (!g.floorId) g.floorId = planFloorId;

  // الطوابق: المعرّفة + «بدون دور» للوحدات غير المرتبطة بدور
  const groups: SceneFloor[] = [...floors, ...virtualFloors].sort((a, b) => a.level - b.level).map((f) => ({ id: f.id, name: f.name, level: f.level, units: [] }));
  const loose: SceneFloor = { id: null, name: floors.length ? "بدون دور محدد" : "الفرع", level: floors.length ? (floors.at(-1)!.level + 1) : 0, units: [] };
  for (const su of [...sceneUnits, ...ghosts]) (groups.find((g) => g.id === su.floorId) ?? loose).units.push(su);
  const all = [...groups, ...(loose.units.length ? [loose] : [])]
    .filter((g) => g.units.length > 0 || groups.length === 0)
    .map((g) => ({ ...g, units: autoLayout(g.units) }));

  const counts = sceneUnits.reduce<Record<SceneTone, number>>(
    (a, u) => ({ ...a, [u.tone]: a[u.tone] + 1 }),
    { available: 0, rented: 0, partial: 0, expiring: 0, reserved: 0, maintenance: 0, inactive: 0, unregistered: 0, facility: 0 },
  );
  counts.unregistered = ghosts.filter((g) => g.kind === "plan").length;
  return {
    branch,
    floors: all,
    counts,
    total: sceneUnits.length,
    placedCount: sceneUnits.filter((u) => u.saved).length,
    hasPlan: plan.length > 0,
    planUnits: usedPlan.size,
    unregisteredCodes: ghosts.filter((g) => g.kind === "plan").map((g) => g.code),
  };
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
