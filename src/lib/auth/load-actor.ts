import type { Db } from "@/lib/db";
import type { Actor } from "./actor";

/** يبني صلاحيات مستخدم من قاعدة البيانات خارج جلسة (للمهام المجدولة والروابط المشتركة). */
export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      branchAccess: { where: { branch: { status: { not: "INACTIVE" } } }, select: { branchId: true } },
    },
  });
  if (!u || !u.isActive) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    roleId: u.roleId,
    roleKey: u.role.key,
    roleNameAr: u.role.nameAr,
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.key)),
    allBranches: u.role.allBranches,
    branchIds: u.branchAccess.map((b) => b.branchId),
    sessionId: null,
    mustChangePassword: false,
  };
}
