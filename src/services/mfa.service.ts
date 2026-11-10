import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type { Db } from "@/lib/db";
import { env } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { generateSessionToken, hashToken } from "@/lib/auth/tokens";
import { createSession, revokeAllUserSessions } from "@/lib/auth/session";
import { requirePermission } from "@/lib/rbac/guard";
import { currentStep, generateSecret, normalizeDigits, otpauthUri, STEP_SECONDS, totpAt, verifyTotp } from "@/lib/totp";
import { open, seal } from "@/lib/secret-box";

/** إعدادات الفرض: الأدوار الإدارية تتطلب التحقق الثنائي (المواصفات: "دعم المصادقة متعددة العوامل للإدارة"). */
export const DEFAULT_MFA_ROLES = ["SUPER_ADMIN", "GENERAL_MANAGER"];
export const CHALLENGE_MINUTES = 5;
export const MAX_CHALLENGE_ATTEMPTS = 5;

export async function mfaRequiredRoles(db: Db): Promise<string[]> {
  const s = await db.systemSetting.findUnique({ where: { key: "security.mfa_required_roles" } });
  return Array.isArray(s?.value) ? s.value.filter((x): x is string => typeof x === "string") : DEFAULT_MFA_ROLES;
}

export function mfaEnforced() {
  const e = env();
  return e.MFA_ENFORCE ?? e.NODE_ENV === "production";
}

/** هل يجب على هذا المستخدم تفعيل التحقق الثنائي قبل استخدام النظام؟ */
export async function mustEnrollMfa(db: Db, actor: Actor) {
  if (!mfaEnforced()) return false;
  const u = await db.user.findUnique({ where: { id: actor.id }, select: { mfaEnabled: true } });
  if (u?.mfaEnabled) return false;
  return (await mfaRequiredRoles(db)).includes(String(actor.roleKey));
}

const hashCode = (c: string) => createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

function newRecoveryCodes() {
  // 8 رموز × 10 أحرف (≈50 بت لكل رمز)، تُعرض مرة واحدة
  return Array.from({ length: 8 }, () => {
    const s = randomBytes(8).toString("base64url").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10).padEnd(10, "X");
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

// ───── التفعيل ─────

const TICKET_MINUTES = 30;
/** نافذة السماح: التفعيل ±4 خطوات (دقيقتان)، والدخول ±3 خطوات (90 ثانية) — مع منع إعادة الاستخدام دائمًا */
export const ENROLL_WINDOW = 4;
export const LOGIN_WINDOW = 3;

/**
 * يبدأ التفعيل: سر جديد غير مفعّل حتى يُؤكد برمز صحيح.
 * يُعاد معه "تذكرة" مشفرة (السر + المستخدم + الوقت) تُرسل مع التأكيد، فيُتحقق من نفس السر
 * المعروض في الصفحة حتى لو بُدئ التفعيل مرة أخرى في تبويب آخر.
 */
export async function beginEnrollment(db: Db, actor: Actor) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (u.mfaEnabled) throw new AppError("STATE", "التحقق الثنائي مفعّل بالفعل");
  const secret = generateSecret();
  await db.user.update({ where: { id: actor.id }, data: { mfaSecretEnc: seal(secret), mfaLastStep: null } });
  const uri = otpauthUri(secret, u.email);
  const qrSvg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  const ticket = seal(JSON.stringify({ u: actor.id, s: secret, t: Date.now() }));
  return { secret, uri, qrSvg, ticket };
}

function secretFromTicket(actorId: string, ticket: string | undefined): string | null {
  if (!ticket) return null;
  let t: { u: string; s: string; t: number };
  try {
    t = JSON.parse(open(ticket));
  } catch {
    return null;
  }
  // الجلسة في المتصفح تتغير لكل التبويبات عند الدخول بحساب آخر
  if (t.u !== actorId)
    throw new AppError("OTHER_ACCOUNT", "تم تسجيل الدخول بحساب آخر في نفس المتصفح بعد بدء التفعيل. سجّل الخروج، وادخل بالحساب المطلوب وحده، ثم ابدأ التفعيل من جديد.");
  if (Date.now() - t.t > TICKET_MINUTES * 60_000) return null;
  return t.s;
}

/** تشخيص: هل الرمز صحيح لكن وقت الجوال مختلف؟ يُرجع الفرق بالثواني (للتأكيد فقط، لا يُقبل للدخول). */
function clockSkew(secret: string, code: string): number | null {
  const c = normalizeDigits(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = currentStep();
  for (let d = ENROLL_WINDOW + 1; d <= 20; d++) for (const k of [cur - d, cur + d]) if (totpAt(secret, k) === c) return (k - cur) * STEP_SECONDS;
  return null;
}

export async function confirmEnrollment(db: Db, actor: Actor, code: string, meta: RequestMeta = {}, ticket?: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (u.mfaEnabled) throw new AppError("STATE", "التحقق الثنائي مفعّل بالفعل");
  const secret = secretFromTicket(actor.id, ticket) ?? (u.mfaSecretEnc ? open(u.mfaSecretEnc) : null);
  if (!secret) throw new AppError("STATE", "انتهت مهلة التفعيل. حدّث الصفحة وابدأ من جديد.");
  const step = verifyTotp(secret, code, null, Date.now(), ENROLL_WINDOW);
  if (step === null) {
    const skew = clockSkew(secret, code);
    if (skew !== null)
      throw new AppError("CLOCK", `الرمز صحيح لكن وقت الجوال ${skew > 0 ? "متقدم" : "متأخر"} بنحو ${Math.abs(skew)} ثانية. فعّل "ضبط الوقت تلقائيًا" في الجوال ثم أعد المحاولة.`);
    throw new AppError("BAD_CODE", "الرمز غير صحيح. احذف أي حساب قديم باسم ZAKI Smart ERP من التطبيق، وامسح الرمز الظاهر الآن، ثم أدخل الرقم الحالي.");
  }
  const codes = newRecoveryCodes();
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.id }, data: { mfaEnabled: true, mfaSecretEnc: seal(secret), mfaLastStep: step, mfaRecoveryHashes: codes.map(hashCode) } });
    // جلسات أخرى قديمة تُنهى؛ الجلسة الحالية تبقى
    await revokeAllUserSessions(tx, actor.id, actor.sessionId ?? undefined);
    await writeAudit(tx, { actorId: actor.id, action: "auth.mfa_enabled", entityType: "user", entityId: actor.id, meta });
  });
  return { recoveryCodes: codes };
}

/** إعادة تعيين التحقق الثنائي لمستخدم (فقد جواله) — بصلاحية إدارة المستخدمين، وتُنهى جلساته. */
export async function resetUserMfa(db: Db, actor: Actor, userId: string, meta: RequestMeta = {}) {
  requirePermission(actor, "users.manage");
  if (userId === actor.id) throw new ForbiddenError("لا يمكنك إعادة تعيين تحققك الثنائي بنفسك؛ اطلب ذلك من مسؤول آخر");
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!u) throw new NotFoundError("المستخدم غير موجود");
  if (u.role.key === "SUPER_ADMIN" && actor.roleKey !== "SUPER_ADMIN") throw new ForbiddenError("لا يمكنك تعديل حساب مسؤول النظام");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { mfaEnabled: false, mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
    await revokeAllUserSessions(tx, userId);
    await writeAudit(tx, { actorId: actor.id, action: "user.mfa_reset", entityType: "user", entityId: userId, meta });
  });
}

// ───── الدخول بالمرحلتين ─────

/** يُستدعى بعد نجاح كلمة المرور لمستخدم مفعّل لديه التحقق الثنائي. */
export async function createChallenge(db: Db, userId: string, meta: RequestMeta = {}) {
  const token = generateSessionToken();
  await db.mfaChallenge.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + CHALLENGE_MINUTES * 60_000), ip: meta.ip?.slice(0, 64) ?? null },
  });
  return token;
}

export type MfaResult = { ok: true; token: string; usedRecovery: boolean; remainingRecovery: number } | { ok: false; error: string; restart?: boolean };

export async function verifyChallenge(db: Db, challengeToken: string | undefined, code: string, meta: RequestMeta = {}): Promise<MfaResult> {
  if (!challengeToken) return { ok: false, error: "انتهت مهلة التحقق. سجّل الدخول من جديد.", restart: true };
  const ch = await db.mfaChallenge.findUnique({ where: { tokenHash: hashToken(challengeToken) }, include: { user: true } });
  if (!ch || ch.consumedAt || ch.expiresAt <= new Date() || ch.attempts >= MAX_CHALLENGE_ATTEMPTS)
    return { ok: false, error: "انتهت مهلة التحقق أو تجاوزت عدد المحاولات. سجّل الدخول من جديد.", restart: true };
  const u = ch.user;
  if (!u.isActive || !u.mfaEnabled || !u.mfaSecretEnc) return { ok: false, error: "لا يمكن إكمال الدخول. تواصل مع مسؤول النظام.", restart: true };

  const clean = normalizeDigits(code).trim();
  let step: number | null = null;
  let usedRecovery = false;
  let remaining = u.mfaRecoveryHashes;
  if (/^\d{6}$/.test(clean.replace(/\s/g, ""))) {
    step = verifyTotp(open(u.mfaSecretEnc), clean, u.mfaLastStep, Date.now(), LOGIN_WINDOW);
  } else {
    const h = hashCode(clean);
    const match = u.mfaRecoveryHashes.find((x) => x.length === h.length && timingSafeEqual(Buffer.from(x), Buffer.from(h)));
    if (match) {
      usedRecovery = true;
      remaining = u.mfaRecoveryHashes.filter((x) => x !== match);
    }
  }

  if (step === null && !usedRecovery) {
    await db.$transaction([
      db.mfaChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } }),
      db.loginAttempt.create({ data: { email: u.email, ip: meta.ip ?? null, success: false } }),
    ]);
    await writeAudit(db, { actorId: u.id, action: "auth.mfa_failed", entityType: "user", entityId: u.id, meta });
    const left = MAX_CHALLENGE_ATTEMPTS - ch.attempts - 1;
    return left > 0 ? { ok: false, error: `الرمز غير صحيح. المحاولات المتبقية: ${left}` } : { ok: false, error: "تجاوزت عدد المحاولات. سجّل الدخول من جديد.", restart: true };
  }

  const { token } = await db.$transaction(async (tx) => {
    // الاستهلاك الذري يمنع استخدام نفس التحدي مرتين بالتوازي
    const done = await tx.mfaChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (done.count !== 1) throw new AppError("STATE", "تم استخدام هذا التحقق بالفعل");
    await tx.user.update({
      where: { id: u.id },
      data: { lastLoginAt: new Date(), failedLoginCount: 0, ...(step !== null ? { mfaLastStep: step } : {}), ...(usedRecovery ? { mfaRecoveryHashes: remaining } : {}) },
    });
    await tx.loginAttempt.create({ data: { email: u.email, ip: meta.ip ?? null, success: true } });
    const s = await createSession(tx, u.id, meta);
    await writeAudit(tx, { actorId: u.id, action: usedRecovery ? "auth.login_recovery_code" : "auth.login", entityType: "user", entityId: u.id, after: { mfa: true }, meta });
    return s;
  });
  return { ok: true, token, usedRecovery, remainingRecovery: remaining.length };
}
