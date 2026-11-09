import type { PermissionKey, RoleKey } from "@/lib/rbac/permissions";

/** المستخدم الحالي كما تراه طبقة الخدمات (محمّل من قاعدة البيانات في كل طلب). */
export type Actor = {
  id: string;
  email: string;
  name: string;
  roleId: string;
  roleKey: RoleKey | string;
  roleNameAr: string;
  permissions: ReadonlySet<PermissionKey | string>;
  allBranches: boolean;
  branchIds: readonly string[];
  sessionId: string | null;
  mustChangePassword: boolean;
};

export type RequestMeta = { ip?: string | null; userAgent?: string | null };
