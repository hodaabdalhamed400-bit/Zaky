import { z } from "zod";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { RequestMeta } from "@/lib/auth/actor";
import { generateSessionToken, hashToken } from "@/lib/auth/tokens";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/lib/auth/password";
import { revokeAllUserSessions } from "@/lib/auth/session";
import { appUrl, brandedEmail, mailConfigured, sendMail } from "@/lib/mail";

/**
 * «نسيت كلمة المرور»:
 * - الرد دائمًا نفس الرسالة سواء الحساب موجود أو لا (منع تعداد الحسابات).
 * - الرابط لمرة واحدة، صالح 30 دقيقة، ويُخزَّن SHA-256 فقط.
 * - لو الإيميل غير مُعدّ: يصل تنبيه داخل النظام لمسؤولي المستخدمين ليعيدوا التعيين يدويًا.
 * - بعد التعيين: تُلغى كل الجلسات ويُطلب الدخول من جديد (التحقق الثنائي يبقى كما هو).
 */
export const RESET_LIMITS = { ttlMinutes: 30, perEmailPerHour: 3, perIpPerHour: 10 };

export const RESET_REQUESTED_MESSAGE =
  "لو البريد مسجّل عندنا، بيوصلك رابط لتعيين كلمة مرور جديدة خلال دقائق. لو ما وصلك، تواصل مع مسؤول النظام.";

const emailSchema = z.string().trim().toLowerCase().email("البريد الإلكتروني غير صحيح").max(200);

export type ResetRequestResult = { ok: true; message: string; delivery: "email" | "admin" | "none" } | { ok: false; error: string };

export async function requestPasswordReset(db: Db, rawEmail: unknown, meta: RequestMeta = {}, send = sendMail): Promise<ResetRequestResult> {
  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "البريد الإلكتروني غير صحيح" };
  const email = parsed.data;
  const hourAgo = new Date(Date.now() - 3600_000);

  if (meta.ip) {
    const byIp = await db.passwordResetToken.count({ where: { ip: meta.ip.slice(0, 64), createdAt: { gte: hourAgo } } });
    if (byIp >= RESET_LIMITS.perIpPerHour) return { ok: false, error: "طلبات كثيرة. حاول مرة أخرى بعد ساعة." };
  }

  const user = await db.user.findUnique({ where: { email }, select: { id: true, name: true, email: true, isActive: true } });
  if (!user || !user.isActive) return { ok: true, message: RESET_REQUESTED_MESSAGE, delivery: "none" };

  const recent = await db.passwordResetToken.count({ where: { userId: user.id, createdAt: { gte: hourAgo } } });
  if (recent >= RESET_LIMITS.perEmailPerHour) return { ok: true, message: RESET_REQUESTED_MESSAGE, delivery: "none" };

  const token = generateSessionToken();
  await db.$transaction(async (tx) => {
    // رابط واحد صالح في نفس الوقت
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await tx.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_LIMITS.ttlMinutes * 60_000),
        ip: meta.ip?.slice(0, 64) ?? null,
      },
    });
    await writeAudit(tx, { actorId: user.id, action: "auth.password_reset_requested", entityType: "user", entityId: user.id, meta });
  });

  if (mailConfigured()) {
    const url = appUrl(`/login/reset?token=${encodeURIComponent(token)}`);
    const body = brandedEmail({
      title: "تعيين كلمة مرور جديدة",
      lines: [`هلا ${user.name}،`, "وصلنا طلب لتعيين كلمة مرور جديدة لحسابك في ZAKI Smart ERP.", `الرابط صالح لمدة ${RESET_LIMITS.ttlMinutes} دقيقة ولمرة وحدة بس.`],
      button: { label: "تعيين كلمة المرور", url },
      footer: "لو ما طلبت هذا، تجاهل الإيميل وكلمة مرورك الحالية تبقى زي ما هي.",
    });
    try {
      await send({ to: user.email, subject: "تعيين كلمة مرور جديدة — ZAKI Smart ERP", ...body });
      return { ok: true, message: RESET_REQUESTED_MESSAGE, delivery: "email" };
    } catch (e) {
      console.error("[password-reset] email failed", e instanceof Error ? e.message : e);
      // يكمل للتنبيه الداخلي كبديل
    }
  }

  // بديل بدون إيميل: تنبيه داخلي لمن يملك إدارة المستخدمين
  const admins = await db.user.findMany({
    where: { isActive: true, id: { not: user.id }, role: { permissions: { some: { permission: { key: "users.manage" } } } } },
    select: { id: true },
  });
  if (admins.length) {
    await db.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        type: "SYSTEM" as const,
        title: `طلب استعادة كلمة المرور: ${user.name}`,
        body: `${user.email} — أعد تعيين كلمة المرور من صفحة المستخدم`,
        link: `/users/${user.id}`,
        entityType: "user",
        entityId: user.id,
        dedupeKey: `PASSWORD_RESET:${user.id}:${new Date().toISOString().slice(0, 13)}`,
      })),
      skipDuplicates: true,
    });
  }
  return { ok: true, message: RESET_REQUESTED_MESSAGE, delivery: "admin" };
}

async function findValidToken(db: Db, token: string) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const t = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isActive: true, passwordHash: true } } },
  });
  if (!t || t.usedAt || t.expiresAt <= new Date() || !t.user.isActive) return null;
  return t;
}

/** للصفحة: هل الرابط صالح؟ (بدون استهلاكه) */
export async function checkResetToken(db: Db, token: string) {
  const t = await findValidToken(db, token);
  return t ? { valid: true as const, email: t.user.email } : { valid: false as const };
}

const resetSchema = z
  .object({ token: z.string().min(20).max(200), newPassword: z.string(), confirmPassword: z.string() })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "تأكيد كلمة المرور غير مطابق", path: ["confirmPassword"] });

export type ResetResult = { ok: true } | { ok: false; error: string; expired?: boolean };

export async function resetPasswordWithToken(db: Db, raw: unknown, meta: RequestMeta = {}): Promise<ResetResult> {
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" };
  const { token, newPassword } = parsed.data;
  const t = await findValidToken(db, token);
  if (!t) return { ok: false, expired: true, error: "الرابط انتهى أو استُخدم قبل. اطلب رابط جديد." };

  const policy = validatePasswordPolicy(newPassword, { email: t.user.email, name: t.user.name });
  if (policy) return { ok: false, error: policy };
  if (await verifyPassword(t.user.passwordHash, newPassword)) return { ok: false, error: "كلمة المرور الجديدة لازم تختلف عن القديمة" };

  const passwordHash = await hashPassword(newPassword);
  const done = await db.$transaction(async (tx) => {
    // استهلاك ذري: لو استُخدم الرابط في نفس اللحظة من طلب آخر، يفشل هذا
    const used = await tx.passwordResetToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) return false;
    await tx.user.update({
      where: { id: t.user.id },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
    await revokeAllUserSessions(tx, t.user.id);
    await writeAudit(tx, { actorId: t.user.id, action: "auth.password_reset_completed", entityType: "user", entityId: t.user.id, meta });
    return true;
  });
  if (!done) return { ok: false, expired: true, error: "الرابط انتهى أو استُخدم قبل. اطلب رابط جديد." };
  return { ok: true };
}
