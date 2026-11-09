import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/password";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/guard";

const phone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+\d\s-]*$/, "رقم الجوال غير صحيح")
  .optional()
  .transform((v) => (v ? v : null));

const baseUser = {
  name: z.string().trim().min(2, "الاسم قصير جدًا").max(120),
  phone,
  roleId: z.string().uuid("اختر الدور"),
  branchIds: z.array(z.string().uuid()).max(100).default([]),
};

export const createUserSchema = z.object({
  ...baseUser,
  email: z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح").max(200),
  password: z.string(),
});

export const updateUserSchema = z.object({
  ...baseUser,
  isActive: z.boolean(),
});

const userSelect = {
  id: true,
  email: true,
  name: true,
  phone: true,
  isActive: true,
  mustChangePassword: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, key: true, nameAr: true, allBranches: true } },
  branchAccess: { select: { branch: { select: { id: true, nameAr: true } } } },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** هل يملك المنفذ صلاحية منح هذا الدور؟ (منع تصعيد الصلاحيات) */
async function assertRoleAssignable(db: Db, actor: Actor, roleId: string) {
  const role = await db.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw new AppError("VALIDATION", "الدور غير موجود");
  if (actor.roleKey === "SUPER_ADMIN") return role;
  if (role.key === "SUPER_ADMIN") throw new ForbiddenError("فقط مسؤول النظام يمكنه منح دور مسؤول النظام");
  const missing = role.permissions.filter((rp) => !actor.permissions.has(rp.permission.key));
  if (missing.length) throw new ForbiddenError("لا يمكنك منح دور يملك صلاحيات أعلى من صلاحياتك");
  if (role.allBranches && !actor.allBranches) throw new ForbiddenError("لا يمكنك منح دور يغطي جميع الفروع");
  return role;
}

async function assertBranchesAssignable(db: Db, actor: Actor, branchIds: string[]) {
  const unique = [...new Set(branchIds)];
  if (!unique.length) return unique;
  const found = await db.branch.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new AppError("VALIDATION", "أحد الفروع المحددة غير موجود");
  if (!actor.allBranches && unique.some((b) => !actor.branchIds.includes(b)))
    throw new ForbiddenError("لا يمكنك منح صلاحية على فرع لا تملكه");
  return unique;
}

async function countActiveSuperAdmins(db: Db | Prisma.TransactionClient, excludeUserId?: string) {
  return db.user.count({
    where: { isActive: true, role: { key: "SUPER_ADMIN" }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
  });
}

export async function listUsers(db: Db, actor: Actor, opts: { q?: string } = {}) {
  requirePermission(actor, "users.view");
  const q = opts.q?.trim();
  return db.user.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] }
      : undefined,
    select: userSelect,
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    take: 500,
  });
}

export async function getUser(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "users.view");
  const user = await db.user.findUnique({ where: { id }, select: userSelect });
  if (!user) throw new NotFoundError("المستخدم غير موجود");
  return user;
}

export async function createUser(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "users.manage");
  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]!.message);
  const input = parsed.data;
  const policy = validatePasswordPolicy(input.password, { email: input.email, name: input.name });
  if (policy) throw new AppError("WEAK_PASSWORD", policy);
  const role = await assertRoleAssignable(db, actor, input.roleId);
  const branchIds = role.allBranches ? [] : await assertBranchesAssignable(db, actor, input.branchIds);
  if (!role.allBranches && branchIds.length === 0)
    throw new AppError("VALIDATION", "يجب تحديد فرع واحد على الأقل لهذا الدور");

  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          phone: input.phone,
          roleId: role.id,
          passwordHash,
          mustChangePassword: true,
          createdById: actor.id,
          branchAccess: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: userSelect,
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "user.create",
        entityType: "user",
        entityId: user.id,
        after: { email: user.email, name: user.name, role: role.key, branchIds },
        meta,
      });
      return user;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      throw new AppError("DUPLICATE", "يوجد مستخدم بهذا البريد الإلكتروني");
    throw e;
  }
}

export async function updateUser(db: Db, actor: Actor, id: string, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "users.manage");
  const parsed = updateUserSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]!.message);
  const input = parsed.data;

  const existing = await db.user.findUnique({
    where: { id },
    include: { role: true, branchAccess: true },
  });
  if (!existing) throw new NotFoundError("المستخدم غير موجود");

  const isSelf = existing.id === actor.id;
  if (existing.role.key === "SUPER_ADMIN" && actor.roleKey !== "SUPER_ADMIN")
    throw new ForbiddenError("لا يمكنك تعديل حساب مسؤول النظام");
  // لا يعدّل المستخدم حسابًا يملك صلاحيات أعلى منه
  if (!isSelf) await assertRoleAssignable(db, actor, existing.roleId);
  if (isSelf && input.roleId !== existing.roleId) throw new ForbiddenError("لا يمكنك تغيير دورك بنفسك");
  if (isSelf && !input.isActive) throw new ForbiddenError("لا يمكنك تعطيل حسابك بنفسك");

  const role = input.roleId === existing.roleId ? existing.role : await assertRoleAssignable(db, actor, input.roleId);
  let branchIds = role.allBranches ? [] : await assertBranchesAssignable(db, actor, input.branchIds);
  // المنفذ المقيد بفروع لا يستطيع رؤية/سحب فروع خارج نطاقه، فتبقى كما هي
  if (!role.allBranches && !actor.allBranches) {
    const outside = existing.branchAccess.map((b) => b.branchId).filter((b) => !actor.branchIds.includes(b));
    branchIds = [...new Set([...branchIds, ...outside])];
  }
  if (!role.allBranches && branchIds.length === 0)
    throw new AppError("VALIDATION", "يجب تحديد فرع واحد على الأقل لهذا الدور");

  return db.$transaction(
    async (tx) => {
      // يجب أن يبقى مسؤول نظام نشط واحد على الأقل
      const losingSuperAdmin =
        existing.role.key === "SUPER_ADMIN" && existing.isActive && (!input.isActive || role.key !== "SUPER_ADMIN");
      if (losingSuperAdmin && (await countActiveSuperAdmins(tx, existing.id)) === 0)
        throw new AppError("LAST_SUPER_ADMIN", "يجب أن يبقى مسؤول نظام نشط واحد على الأقل");

      await tx.userBranchAccess.deleteMany({ where: { userId: id } });
      const user = await tx.user.update({
        where: { id },
        data: {
          name: input.name,
          phone: input.phone,
          roleId: role.id,
          isActive: input.isActive,
          branchAccess: { create: branchIds.map((branchId) => ({ branchId })) },
        },
        select: userSelect,
      });
      if (!input.isActive && existing.isActive) await revokeAllUserSessions(tx, id);

      const action =
        existing.isActive !== input.isActive ? (input.isActive ? "user.activate" : "user.deactivate") : "user.update";
      await writeAudit(tx, {
        actorId: actor.id,
        action,
        entityType: "user",
        entityId: id,
        before: {
          name: existing.name,
          phone: existing.phone,
          role: existing.role.key,
          isActive: existing.isActive,
          branchIds: existing.branchAccess.map((b) => b.branchId).sort(),
        },
        after: { name: user.name, phone: user.phone, role: role.key, isActive: user.isActive, branchIds: [...branchIds].sort() },
        meta,
      });
      return user;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function resetUserPassword(db: Db, actor: Actor, id: string, newPassword: string, meta: RequestMeta = {}) {
  requirePermission(actor, "users.manage");
  const existing = await db.user.findUnique({ where: { id }, include: { role: true } });
  if (!existing) throw new NotFoundError("المستخدم غير موجود");
  if (existing.role.key === "SUPER_ADMIN" && actor.roleKey !== "SUPER_ADMIN")
    throw new ForbiddenError("لا يمكنك إعادة تعيين كلمة مرور مسؤول النظام");
  if (existing.id !== actor.id) await assertRoleAssignable(db, actor, existing.roleId);
  if (existing.id === actor.id) throw new AppError("USE_ACCOUNT_PAGE", "لتغيير كلمة مرورك استخدم صفحة حسابي");
  const policy = validatePasswordPolicy(newPassword, { email: existing.email, name: existing.name });
  if (policy) throw new AppError("WEAK_PASSWORD", policy);
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0 },
    });
    await revokeAllUserSessions(tx, id);
    await writeAudit(tx, { actorId: actor.id, action: "user.password_reset", entityType: "user", entityId: id, meta });
  });
}

export async function listAssignableOptions(db: Db, actor: Actor) {
  requirePermission(actor, "users.manage");
  const [roles, branches] = await Promise.all([
    db.role.findMany({
      orderBy: { createdAt: "asc" },
      include: { permissions: { include: { permission: true } } },
    }),
    db.branch.findMany({
      where: actor.allBranches ? { isActive: true } : { isActive: true, id: { in: [...actor.branchIds] } },
      orderBy: { code: "asc" },
      select: { id: true, nameAr: true, code: true },
    }),
  ]);
  const assignableRoles = roles.filter(
    (r) =>
      actor.roleKey === "SUPER_ADMIN" ||
      (r.key !== "SUPER_ADMIN" &&
        (!r.allBranches || actor.allBranches) &&
        r.permissions.every((rp) => actor.permissions.has(rp.permission.key))),
  );
  return {
    roles: assignableRoles.map((r) => ({ id: r.id, key: r.key, nameAr: r.nameAr, allBranches: r.allBranches })),
    branches,
  };
}
