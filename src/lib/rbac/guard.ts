import type { Actor } from "@/lib/auth/actor";
import { AuthError, ForbiddenError } from "@/lib/errors";
import type { PermissionKey } from "./permissions";

export function can(actor: Actor | null | undefined, perm: PermissionKey): boolean {
  return !!actor && actor.permissions.has(perm);
}

export function requirePermission(actor: Actor | null | undefined, perm: PermissionKey): Actor {
  if (!actor) throw new AuthError();
  if (!actor.permissions.has(perm)) throw new ForbiddenError();
  return actor;
}

export function hasBranchAccess(actor: Actor, branchId: string): boolean {
  return actor.allBranches || actor.branchIds.includes(branchId);
}

export function assertBranchAccess(actor: Actor, branchId: string): void {
  if (!hasBranchAccess(actor, branchId)) throw new ForbiddenError("ليست لديك صلاحية على هذا الفرع");
}

/**
 * شرط Prisma لتقييد الاستعلام بفروع المستخدم.
 * الاستخدام: where: { ...branchWhere(actor, "branchId") }
 */
export function branchWhere<K extends string>(actor: Actor, field: K): Record<K, { in: string[] }> | Record<string, never> {
  if (actor.allBranches) return {};
  return { [field]: { in: [...actor.branchIds] } } as Record<K, { in: string[] }>;
}
