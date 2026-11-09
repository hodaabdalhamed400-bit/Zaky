import type { Db, Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { generateSessionToken, hashToken } from "./tokens";
import type { Actor, RequestMeta } from "./actor";

export async function createSession(db: Db | Tx, userId: string, meta: RequestMeta = {}, now = new Date()) {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + env().SESSION_MAX_AGE_HOURS * 3600_000);
  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      createdAt: now,
      lastSeenAt: now,
      ip: meta.ip?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    },
  });
  return { token, session };
}

/**
 * يتحقق من الجلسة ويحمّل المستخدم بصلاحياته وفروعه من قاعدة البيانات.
 * أي تغيير في الدور/الفروع/التعطيل يسري فورًا على الطلب التالي.
 */
export async function validateSession(db: Db, token: string | null | undefined, now = new Date()): Promise<Actor | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          branchAccess: { where: { branch: { status: { not: "INACTIVE" } } }, select: { branchId: true } },
        },
      },
    },
  });
  if (!session || session.revokedAt) return null;
  const idleMs = env().SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
  const user = session.user;
  const expired =
    session.expiresAt <= now ||
    now.getTime() - session.lastSeenAt.getTime() > idleMs ||
    !user.isActive ||
    user.passwordChangedAt > session.createdAt;
  if (expired) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: now } }).catch(() => {});
    return null;
  }
  // تحديث آخر نشاط بحد أقصى مرة كل دقيقة لتقليل الكتابة
  if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } }).catch(() => {});
  }
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roleId: user.roleId,
    roleKey: user.role.key,
    roleNameAr: user.role.nameAr,
    permissions: new Set(user.role.permissions.map((rp) => rp.permission.key)),
    allBranches: user.role.allBranches,
    branchIds: user.branchAccess.map((b) => b.branchId),
    sessionId: session.id,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function revokeSession(db: Db | Tx, sessionId: string) {
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllUserSessions(db: Db | Tx, userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
