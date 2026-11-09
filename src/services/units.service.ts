import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma, type UnitStatus, type PricingCycle } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, branchWhere, hasBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh } from "@/lib/dates";
import { decimalString, optionalDecimalString, optionalText, parseInput } from "@/lib/validation";
import { unitHasCurrentOrFutureBookings, unitOccupancyToday } from "./occupancy.service";

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  AVAILABLE: "متاحة",
  RESERVED: "محجوزة",
  RENTED: "مؤجرة",
  MAINTENANCE: "صيانة",
  INACTIVE: "غير نشطة",
};
export const PRICING_CYCLE_LABELS: Record<PricingCycle, string> = { HOUR: "ساعة", DAY: "يوم", MONTH: "شهر", YEAR: "سنة" };

/**
 * الحالات التي يضبطها الموظف يدويًا. "مؤجرة" لا تُضبط يدويًا: تُشتق من العقود النشطة
 * (مصدر واحد للحقيقة — يمنع وحدة "مؤجرة" بلا عقد أو "متاحة" وعليها عقد).
 */
export const MANUAL_UNIT_STATUSES = ["AVAILABLE", "RESERVED", "MAINTENANCE", "INACTIVE"] as const;

const unitSchema = z.object({
  branchId: z.string().uuid("اختر الفرع"),
  floorId: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.union([z.null(), z.string().uuid()])),
  unitTypeId: z.string().uuid("اختر نوع الوحدة"),
  code: z
    .string()
    .trim()
    .min(1, "أدخل رقم الوحدة")
    .max(30)
    .regex(/^[\p{L}\p{N}\s\-_/.]+$/u, "رقم الوحدة يحتوي رموزًا غير مسموحة"),
  areaSqm: optionalDecimalString("المساحة"),
  capacity: z.coerce.number({ message: "السعة غير صحيحة" }).int("السعة عدد صحيح").min(1, "السعة لا تقل عن 1").max(1000),
  basePrice: decimalString("السعر الأساسي", { allowZero: true }),
  pricingCycle: z.enum(["HOUR", "DAY", "MONTH", "YEAR"], { message: "اختر دورة التسعير" }),
  description: optionalText(2000),
  status: z.enum(MANUAL_UNIT_STATUSES, { message: "اختر حالة صحيحة (حالة مؤجرة تُحدد تلقائيًا من العقود)" }),
});
export type UnitInput = z.input<typeof unitSchema>;

const AUDIT_FIELDS = ["branchId", "floorId", "unitTypeId", "code", "areaSqm", "capacity", "basePrice", "pricingCycle", "description", "status", "archivedAt"] as const;
const pick = (u: Record<string, unknown>) =>
  Object.fromEntries(AUDIT_FIELDS.map((k) => [k, u[k] instanceof Prisma.Decimal ? (u[k] as Prisma.Decimal).toFixed(2) : (u[k] ?? null)]));

export const unitFiltersSchema = z.object({
  branchId: z.string().uuid().optional().catch(undefined),
  unitTypeId: z.string().uuid().optional().catch(undefined),
  // OCCUPIED/FREE حالات مشتقة من العقود، والبقية حالات يدوية
  status: z.enum(["OCCUPIED", "FREE", ...MANUAL_UNIT_STATUSES]).optional().catch(undefined),
  q: z.string().trim().max(60).optional().catch(undefined),
  minArea: z.string().regex(/^\d+(\.\d+)?$/).optional().catch(undefined),
  maxArea: z.string().regex(/^\d+(\.\d+)?$/).optional().catch(undefined),
  minPrice: z.string().regex(/^\d+(\.\d+)?$/).optional().catch(undefined),
  maxPrice: z.string().regex(/^\d+(\.\d+)?$/).optional().catch(undefined),
  archived: z.enum(["1"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});
export type UnitFilters = z.infer<typeof unitFiltersSchema>;
export const UNITS_PAGE_SIZE = 30;

function occupiedNow(today: string): Prisma.ContractUnitListRelationFilter {
  return {
    some: {
      contract: { status: "ACTIVE" },
      startDate: { lte: dateOnly(today) },
      endDate: { gte: dateOnly(today) },
    },
  };
}

export async function listUnits(db: Db, actor: Actor, rawFilters: unknown) {
  requirePermission(actor, "units.view");
  const f = unitFiltersSchema.parse(rawFilters ?? {});
  if (f.branchId) assertBranchAccess(actor, f.branchId);
  const today = todayInRiyadh();

  const and: Prisma.UnitWhereInput[] = [branchWhere(actor, "branchId")];
  if (f.branchId) and.push({ branchId: f.branchId });
  if (f.unitTypeId) and.push({ unitTypeId: f.unitTypeId });
  and.push(f.archived ? { archivedAt: { not: null } } : { archivedAt: null });
  if (f.q) and.push({ OR: [{ code: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] });
  if (f.minArea) and.push({ areaSqm: { gte: f.minArea } });
  if (f.maxArea) and.push({ areaSqm: { lte: f.maxArea } });
  if (f.minPrice) and.push({ basePrice: { gte: f.minPrice } });
  if (f.maxPrice) and.push({ basePrice: { lte: f.maxPrice } });
  if (f.status === "OCCUPIED") and.push({ contractUnits: occupiedNow(today) });
  else if (f.status === "FREE") and.push({ status: "AVAILABLE", NOT: { contractUnits: occupiedNow(today) } });
  else if (f.status) and.push({ status: f.status });

  const where: Prisma.UnitWhereInput = { AND: and };
  const page = f.page ?? 1;
  const [total, units] = await Promise.all([
    db.unit.count({ where }),
    db.unit.findMany({
      where,
      include: {
        branch: { select: { id: true, nameAr: true, code: true } },
        floor: { select: { id: true, name: true } },
        unitType: { select: { id: true, nameAr: true } },
      },
      orderBy: [{ branch: { nameAr: "asc" } }, { code: "asc" }],
      skip: (page - 1) * UNITS_PAGE_SIZE,
      take: UNITS_PAGE_SIZE,
    }),
  ]);
  const occ = await unitOccupancyToday(db, units.map((u) => u.id), today);
  return {
    filters: f,
    page,
    total,
    pages: Math.max(1, Math.ceil(total / UNITS_PAGE_SIZE)),
    units: units.map((u) => ({ ...u, occupiedSeats: occ.get(u.id) ?? 0 })),
  };
}

/** الحالة المعروضة: المشتقة من العقود تتقدم على الحالة اليدوية. */
export function effectiveUnitStatus(u: { status: UnitStatus; occupancyMode: string; capacity: number; archivedAt: Date | null }, occupiedSeats: number) {
  if (u.archivedAt) return { key: "ARCHIVED", label: "مؤرشفة", color: "gray" as const };
  if (occupiedSeats > 0) {
    if (u.occupancyMode === "SHARED" && occupiedSeats < u.capacity)
      return { key: "PARTIAL", label: `مؤجرة جزئيًا ${occupiedSeats}/${u.capacity}`, color: "blue" as const };
    return { key: "OCCUPIED", label: "مؤجرة", color: "brand" as const };
  }
  const color = ({ AVAILABLE: "green", RESERVED: "amber", RENTED: "brand", MAINTENANCE: "red", INACTIVE: "gray" } as const)[u.status];
  return { key: u.status, label: UNIT_STATUS_LABELS[u.status], color };
}

export async function getUnit(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "units.view");
  const unit = await db.unit.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, nameAr: true, code: true } },
      floor: { select: { id: true, name: true } },
      unitType: true,
      contractUnits: {
        orderBy: { startDate: "desc" },
        include: {
          contract: { select: { id: true, contractNo: true, status: true, tenant: { select: { id: true, name: true } } } },
        },
      },
    },
  });
  if (!unit) throw new NotFoundError("الوحدة غير موجودة");
  assertBranchAccess(actor, unit.branchId);
  const [occ, history] = await Promise.all([
    unitOccupancyToday(db, [unit.id]),
    db.auditLog.findMany({
      where: { entityType: "unit", entityId: unit.id },
      orderBy: { id: "desc" },
      take: 30,
      include: { user: { select: { name: true } } },
    }),
  ]);
  return { unit, occupiedSeats: occ.get(unit.id) ?? 0, history };
}

async function validateRefs(db: Db, actor: Actor, input: z.infer<typeof unitSchema>) {
  assertBranchAccess(actor, input.branchId);
  const [branch, type, floor] = await Promise.all([
    db.branch.findUnique({ where: { id: input.branchId } }),
    db.unitType.findUnique({ where: { id: input.unitTypeId } }),
    input.floorId ? db.floor.findUnique({ where: { id: input.floorId } }) : null,
  ]);
  if (!branch) throw new AppError("VALIDATION", "الفرع غير موجود");
  if (branch.status === "INACTIVE") throw new AppError("VALIDATION", "لا يمكن إضافة وحدات لفرع موقوف");
  if (!type || !type.isActive) throw new AppError("VALIDATION", "نوع الوحدة غير متاح");
  if (input.floorId && (!floor || floor.branchId !== input.branchId))
    throw new AppError("VALIDATION", "الدور المحدد لا يتبع هذا الفرع");
  if (type.occupancyMode === "EXCLUSIVE" && input.capacity < 1) throw new AppError("VALIDATION", "السعة غير صحيحة");
  return { type };
}

function uniqueCodeError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
    throw new AppError("DUPLICATE", "رقم الوحدة مستخدم في هذا الفرع");
  throw e;
}

export async function createUnit(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  const input = parseInput(unitSchema, raw);
  const { type } = await validateRefs(db, actor, input);
  try {
    return await db.$transaction(async (tx) => {
      const u = await tx.unit.create({ data: { ...input, occupancyMode: type.occupancyMode } });
      await writeAudit(tx, { actorId: actor.id, action: "unit.create", entityType: "unit", entityId: u.id, branchId: u.branchId, after: pick(u), meta });
      return u;
    });
  } catch (e) {
    uniqueCodeError(e);
  }
}

export async function updateUnit(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  const input = parseInput(unitSchema, raw);
  const existing = await db.unit.findUnique({ where: { id }, include: { unitType: true } });
  if (!existing) throw new NotFoundError("الوحدة غير موجودة");
  assertBranchAccess(actor, existing.branchId);
  if (existing.archivedAt) throw new AppError("ARCHIVED", "الوحدة مؤرشفة؛ استعدها أولًا");
  const { type } = await validateRefs(db, actor, input);

  const hasHistory = (await db.contractUnit.count({ where: { unitId: id } })) > 0;
  if (hasHistory && input.branchId !== existing.branchId)
    throw new AppError("LOCKED", "لا يمكن نقل وحدة لها عقود إلى فرع آخر؛ أنشئ وحدة جديدة");
  if (hasHistory && type.occupancyMode !== existing.occupancyMode)
    throw new AppError("LOCKED", "لا يمكن التحويل بين وحدة حصرية ومشتركة بعد ارتباطها بعقود");
  if (input.status === "INACTIVE" && (await unitHasCurrentOrFutureBookings(db, id)))
    throw new AppError("HAS_BOOKINGS", "لا يمكن جعل الوحدة غير نشطة وعليها عقد ساري أو قادم");
  if (input.capacity < existing.capacity && existing.occupancyMode === "SHARED") {
    const occ = (await unitOccupancyToday(db, [id])).get(id) ?? 0;
    if (input.capacity < occ) throw new AppError("CAPACITY", `السعة لا يمكن أن تقل عن المقاعد المؤجرة حاليًا (${occ})`);
  }

  try {
    return await db.$transaction(async (tx) => {
      const u = await tx.unit.update({ where: { id }, data: { ...input, occupancyMode: type.occupancyMode } });
      const action = existing.status !== u.status ? "unit.status_change" : "unit.update";
      await writeAudit(tx, { actorId: actor.id, action, entityType: "unit", entityId: id, branchId: u.branchId, before: pick(existing), after: pick(u), meta });
      return u;
    });
  } catch (e) {
    uniqueCodeError(e);
  }
}

/** أرشفة بدل الحذف: تبقى الوحدة وسجل إشغالها للتقارير التاريخية. */
export async function setUnitArchived(db: Db, actor: Actor, id: string, archived: boolean, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  const u = await db.unit.findUnique({ where: { id } });
  if (!u) throw new NotFoundError("الوحدة غير موجودة");
  assertBranchAccess(actor, u.branchId);
  if (archived && (await unitHasCurrentOrFutureBookings(db, id)))
    throw new AppError("HAS_BOOKINGS", "لا يمكن أرشفة وحدة عليها عقد ساري أو قادم");
  return db.$transaction(async (tx) => {
    const updated = await tx.unit.update({ where: { id }, data: { archivedAt: archived ? new Date() : null } });
    await writeAudit(tx, {
      actorId: actor.id,
      action: archived ? "unit.archive" : "unit.restore",
      entityType: "unit",
      entityId: id,
      branchId: u.branchId,
      before: pick(u),
      after: pick(updated),
      meta,
    });
    return updated;
  });
}

/** بيانات نماذج الوحدات: الفروع المتاحة للمستخدم وأدوارها وأنواع الوحدات. */
export async function unitFormOptions(db: Db, actor: Actor) {
  requirePermission(actor, "units.view");
  const [branches, types] = await Promise.all([
    db.branch.findMany({
      where: { status: { not: "INACTIVE" }, ...branchWhere(actor, "id") },
      orderBy: { nameAr: "asc" },
      select: { id: true, nameAr: true, floors: { orderBy: [{ level: "asc" }, { name: "asc" }], select: { id: true, name: true } } },
    }),
    db.unitType.findMany({ orderBy: [{ isSystem: "desc" }, { nameAr: "asc" }] }),
  ]);
  return { branches: branches.filter((b) => hasBranchAccess(actor, b.id)), types };
}

// ───── أنواع الوحدات المخصصة ─────

const unitTypeSchema = z.object({
  nameAr: z.string().trim().min(2, "اسم النوع قصير جدًا").max(60),
  occupancyMode: z.enum(["EXCLUSIVE", "SHARED"], { message: "اختر طريقة الإشغال" }),
  leaseMode: z.enum(["LEASE", "BOOKING"], { message: "اختر طريقة التأجير" }).default("LEASE"),
});

export async function createUnitType(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "branches.manage");
  const input = parseInput(unitTypeSchema, raw);
  if (await db.unitType.findFirst({ where: { nameAr: { equals: input.nameAr, mode: "insensitive" } } }))
    throw new AppError("DUPLICATE", "يوجد نوع بنفس الاسم");
  return db.$transaction(async (tx) => {
    const t = await tx.unitType.create({ data: { ...input, key: `CUSTOM_${randomUUID().slice(0, 8).toUpperCase()}` } });
    await writeAudit(tx, { actorId: actor.id, action: "unit_type.create", entityType: "unit_type", entityId: t.id, after: input, meta });
    return t;
  });
}

export async function setUnitTypeActive(db: Db, actor: Actor, id: string, isActive: boolean, meta: RequestMeta = {}) {
  requirePermission(actor, "branches.manage");
  const t = await db.unitType.findUnique({ where: { id } });
  if (!t) throw new NotFoundError("النوع غير موجود");
  return db.$transaction(async (tx) => {
    const u = await tx.unitType.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, { actorId: actor.id, action: isActive ? "unit_type.activate" : "unit_type.deactivate", entityType: "unit_type", entityId: id, before: { isActive: t.isActive }, after: { isActive }, meta });
    return u;
  });
}
