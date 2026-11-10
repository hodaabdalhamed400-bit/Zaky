import { z } from "zod";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { hashPassword, validatePasswordPolicy, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { createSession, revokeAllUserSessions, revokeSession } from "@/lib/auth/session";
import { createChallenge } from "./mfa.service";

/** حدود محاولات الدخول (قابلة للتعديل لاحقًا من الإعدادات). */
export const LOGIN_LIMITS = {
  windowMinutes: 15,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 30,
};

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح").max(200),
  password: z.string().min(1, "أدخل كلمة المرور").max(200),
});

export type LoginResult =
  | { ok: true; token: string; userId: string; mustChangePassword: boolean }
  | { ok: "mfa"; challengeToken: string }
  | { ok: false; error: string };

const GENERIC_FAIL = "البريد الإلكتروني أو كلمة المرور غير صحيحة";
const RATE_LIMITED = `محاولات كثيرة غير ناجحة. حاول مرة أخرى بعد ${LOGIN_LIMITS.windowMinutes} دقيقة.`;

export async function login(db: Db, raw: { email: unknown; password: unknown }, meta: RequestMeta = {}): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_FAIL };
  const { email, password } = parsed.data;
  const since = new Date(Date.now() - LOGIN_LIMITS.windowMinutes * 60_000);

  // ── تحديد المعدل: حسب البريد (منذ آخر دخول ناجح) وحسب عنوان IP ──
  const lastSuccess = await db.loginAttempt.findFirst({
    where: { email, success: true, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const emailFailures = await db.loginAttempt.count({
    where: { email, success: false, createdAt: { gte: lastSuccess?.createdAt ?? since } },
  });
  const ipFailures = meta.ip
    ? await db.loginAttempt.count({ where: { ip: meta.ip, success: false, createdAt: { gte: since } } })
    : 0;
  if (emailFailures >= LOGIN_LIMITS.maxFailuresPerEmail || ipFailures >= LOGIN_LIMITS.maxFailuresPerIp) {
    await db.loginAttempt.create({ data: { email, ip: meta.ip ?? null, success: false } });
    return { ok: false, error: RATE_LIMITED };
  }

  const user = await db.user.findUnique({ where: { email } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : (await verifyAgainstDummy(password), false);

  if (!user || !valid) {
    await db.$transaction([
      db.loginAttempt.create({ data: { email, ip: meta.ip ?? null, success: false } }),
      ...(user
        ? [db.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } })]
        : []),
    ]);
    if (user) await writeAudit(db, { actorId: user.id, action: "auth.login_failed", entityType: "user", entityId: user.id, meta });
    return { ok: false, error: GENERIC_FAIL };
  }

  if (!user.isActive) {
    await db.loginAttempt.create({ data: { email, ip: meta.ip ?? null, success: false } });
    return { ok: false, error: "هذا الحساب معطل. تواصل مع مسؤول النظام." };
  }

  // المرحلة الثانية: كلمة المرور صحيحة لكن الجلسة لا تُنشأ إلا بعد رمز التحقق الثنائي
  if (user.mfaEnabled) return { ok: "mfa", challengeToken: await createChallenge(db, user.id, meta) };

  const { token } = await db.$transaction(async (tx) => {
    await tx.loginAttempt.create({ data: { email, ip: meta.ip ?? null, success: true } });
    await tx.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const s = await createSession(tx, user.id, meta);
    await writeAudit(tx, { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, meta });
    return s;
  });

  return { ok: true, token, userId: user.id, mustChangePassword: user.mustChangePassword };
}

export async function logout(db: Db, actor: Actor | null, meta: RequestMeta = {}) {
  if (!actor?.sessionId) return;
  await revokeSession(db, actor.sessionId);
  await writeAudit(db, { actorId: actor.id, action: "auth.logout", entityType: "user", entityId: actor.id, meta });
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "أدخل كلمة المرور الحالية"),
    newPassword: z.string(),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "تأكيد كلمة المرور غير مطابق", path: ["confirmPassword"] });

/** يغير كلمة مرور المستخدم الحالي، ويُنهي جميع جلساته الأخرى. يُرجع رمز جلسة جديدة. */
export async function changeOwnPassword(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0]!.message);
  const { currentPassword, newPassword } = parsed.data;

  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, currentPassword)))
    throw new AppError("BAD_PASSWORD", "كلمة المرور الحالية غير صحيحة");
  const policy = validatePasswordPolicy(newPassword, { email: user.email, name: user.name });
  if (policy) throw new AppError("WEAK_PASSWORD", policy);
  if (await verifyPassword(user.passwordHash, newPassword))
    throw new AppError("SAME_PASSWORD", "كلمة المرور الجديدة يجب أن تختلف عن الحالية");

  const passwordHash = await hashPassword(newPassword);
  return db.$transaction(async (tx) => {
    // passwordChangedAt يُبطل جميع الجلسات السابقة تلقائيًا (انظر validateSession).
    // نفس الطابع الزمني للجلسة الجديدة حتى لا تُعتبر أقدم من تغيير كلمة المرور.
    const changedAt = new Date();
    await tx.user.update({
      where: { id: actor.id },
      data: { passwordHash, passwordChangedAt: changedAt, mustChangePassword: false },
    });
    await revokeAllUserSessions(tx, actor.id);
    const s = await createSession(tx, actor.id, meta, changedAt);
    await writeAudit(tx, { actorId: actor.id, action: "auth.password_changed", entityType: "user", entityId: actor.id, meta });
    return { token: s.token };
  });
}
