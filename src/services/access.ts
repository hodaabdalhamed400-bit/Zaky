import type { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { NotFoundError } from "@/lib/errors";

/**
 * نطاق رؤية المستأجرين: المستأجر يتبع فرعه الأساسي، ويظهر أيضًا لفروع لديها عقود معه.
 */
export function tenantScope(actor: Actor): Prisma.TenantWhereInput {
  if (actor.allBranches) return {};
  const ids = [...actor.branchIds];
  return { OR: [{ primaryBranchId: { in: ids } }, { contracts: { some: { branchId: { in: ids } } } }] };
}

export async function assertTenantAccess(db: Db, actor: Actor, tenantId: string) {
  const t = await db.tenant.findFirst({ where: { id: tenantId, ...tenantScope(actor) }, select: { id: true } });
  // نفس رسالة "غير موجود" حتى لا يُكشف وجود مستأجر في فرع آخر
  if (!t) throw new NotFoundError("المستأجر غير موجود");
}
