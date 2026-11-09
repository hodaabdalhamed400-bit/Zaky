import { z } from "zod";
import { Prisma, type BranchStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, branchWhere, requirePermission } from "@/lib/rbac/guard";
import { httpsUrl, optionalText, parseInput, phoneSchema } from "@/lib/validation";
import { computeOccupancy } from "./occupancy.service";

export const BRANCH_STATUS_LABELS: Record<BranchStatus, string> = {
  ACTIVE: "عامل",
  PREPARING: "قيد التجهيز",
  INACTIVE: "موقوف",
};

export const BRANCH_STATUS_COLOR = { ACTIVE: "green", PREPARING: "amber", INACTIVE: "gray" } as const;

const branchSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,5}$/, "رمز الفرع: من 2 إلى 6 أحرف إنجليزية أو أرقام، يبدأ بحرف"),
  nameAr: z.string().trim().min(2, "اسم الفرع قصير جدًا").max(100),
  city: optionalText(80),
  address: optionalText(300),
  mapUrl: httpsUrl,
  managerName: optionalText(120),
  managerActing: z.boolean().default(false),
  contactPerson: optionalText(120),
  phone: phoneSchema,
  notes: optionalText(2000),
  status: z.enum(["ACTIVE", "PREPARING", "INACTIVE"], { message: "اختر حالة الفرع" }),
});
export type BranchInput = z.input<typeof branchSchema>;

const AUDIT_FIELDS = [
  "code", "nameAr", "city", "address", "mapUrl", "managerName", "managerActing", "contactPerson", "phone", "notes", "status",
] as const;
const pick = (b: Record<string, unknown>) => Object.fromEntries(AUDIT_FIELDS.map((k) => [k, b[k] ?? null]));

function uniqueError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    const target = String((e.meta as { target?: unknown })?.target ?? "");
    throw new AppError("DUPLICATE", target.includes("code") ? "رمز الفرع مستخدم لفرع آخر" : "يوجد فرع بنفس الاسم");
  }
  throw e;
}

/** قائمة الفروع المصرح بها مع الإشغال (مقيدة بفروع المستخدم). */
export async function listBranches(db: Db, actor: Actor) {
  requirePermission(actor, "branches.view");
  const branches = await db.branch.findMany({
    where: branchWhere(actor, "id"),
    orderBy: [{ status: "asc" }, { nameAr: "asc" }],
  });
  const occ = await computeOccupancy(db, branches.map((b) => b.id));
  return { branches: branches.map((b) => ({ ...b, occupancy: occ.get(b.id) })), total: occ.total };
}

export async function getBranch(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "branches.view");
  const branch = await db.branch.findUnique({
    where: { id },
    include: {
      floors: { orderBy: [{ level: "asc" }, { name: "asc" }], include: { _count: { select: { units: true } } } },
    },
  });
  if (!branch) throw new NotFoundError("الفرع غير موجود");
  assertBranchAccess(actor, branch.id);
  const [occ, activeContracts, activeValue, unitsByStatus] = await Promise.all([
    computeOccupancy(db, [branch.id]),
    db.contract.count({ where: { branchId: id, status: "ACTIVE" } }),
    db.contract.aggregate({ where: { branchId: id, status: "ACTIVE" }, _sum: { totalAmount: true } }),
    db.unit.groupBy({ by: ["status"], where: { branchId: id, archivedAt: null }, _count: true }),
  ]);
  return {
    branch,
    occupancy: occ.get(id),
    activeContracts,
    activeContractsValue: (activeValue._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
    unitsByStatus: Object.fromEntries(unitsByStatus.map((g) => [g.status, g._count])) as Partial<Record<string, number>>,
  };
}

export async function createBranch(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "branches.manage");
  if (!actor.allBranches) throw new ForbiddenError("إنشاء الفروع متاح فقط للأدوار التي تغطي جميع الفروع");
  const input = parseInput(branchSchema, raw);
  try {
    return await db.$transaction(async (tx) => {
      const b = await tx.branch.create({ data: input });
      await writeAudit(tx, { actorId: actor.id, action: "branch.create", entityType: "branch", entityId: b.id, branchId: b.id, after: pick(b), meta });
      return b;
    });
  } catch (e) {
    uniqueError(e);
  }
}

export async function updateBranch(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "branches.manage");
  const input = parseInput(branchSchema, raw);
  const existing = await db.branch.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("الفرع غير موجود");
  assertBranchAccess(actor, id);

  if (input.code !== existing.code && (await db.contract.count({ where: { branchId: id } })) > 0)
    throw new AppError("CODE_LOCKED", "لا يمكن تغيير رمز فرع له عقود مسجلة (يدخل في ترقيم العقود)");

  if (input.status === "INACTIVE" && existing.status !== "INACTIVE") {
    const blocking = await db.contract.count({ where: { branchId: id, status: { in: ["ACTIVE", "PENDING_APPROVAL"] } } });
    if (blocking > 0)
      throw new AppError("BRANCH_HAS_CONTRACTS", `لا يمكن إيقاف الفرع: يوجد ${blocking} عقد نشط أو بانتظار الاعتماد. أنهِها أولًا.`);
  }

  try {
    return await db.$transaction(async (tx) => {
      const b = await tx.branch.update({
        where: { id },
        data: { ...input, archivedAt: input.status === "INACTIVE" ? (existing.archivedAt ?? new Date()) : null },
      });
      const action = existing.status !== b.status ? "branch.status_change" : "branch.update";
      await writeAudit(tx, { actorId: actor.id, action, entityType: "branch", entityId: id, branchId: id, before: pick(existing), after: pick(b), meta });
      return b;
    });
  } catch (e) {
    uniqueError(e);
  }
}

// ───── الأدوار (الطوابق) ─────

const floorSchema = z.object({
  name: z.string().trim().min(1, "أدخل اسم الدور").max(60),
  level: z.coerce.number().int("رقم الدور يجب أن يكون عددًا صحيحًا").min(-5).max(200),
});

export async function createFloor(db: Db, actor: Actor, branchId: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  assertBranchAccess(actor, branchId);
  const input = parseInput(floorSchema, raw);
  try {
    return await db.$transaction(async (tx) => {
      const f = await tx.floor.create({ data: { ...input, branchId } });
      await writeAudit(tx, { actorId: actor.id, action: "floor.create", entityType: "floor", entityId: f.id, branchId, after: input, meta });
      return f;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("DUPLICATE", "يوجد دور بنفس الاسم في هذا الفرع");
    throw e;
  }
}

export async function deleteFloor(db: Db, actor: Actor, floorId: string, meta: RequestMeta = {}) {
  requirePermission(actor, "units.manage");
  const floor = await db.floor.findUnique({ where: { id: floorId }, include: { _count: { select: { units: true } } } });
  if (!floor) throw new NotFoundError("الدور غير موجود");
  assertBranchAccess(actor, floor.branchId);
  if (floor._count.units > 0) throw new AppError("FLOOR_IN_USE", "لا يمكن حذف دور مرتبط بوحدات (بما فيها المؤرشفة)");
  await db.$transaction(async (tx) => {
    await tx.floor.delete({ where: { id: floorId } });
    await writeAudit(tx, { actorId: actor.id, action: "floor.delete", entityType: "floor", entityId: floorId, branchId: floor.branchId, before: { name: floor.name, level: floor.level }, meta });
  });
}
