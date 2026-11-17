import type { Db } from "@/lib/db";
import type { RequestMeta } from "@/lib/auth/actor";
import { hashToken } from "@/lib/auth/tokens";
import { appUrl, brandedEmail, mailConfigured, sendMail } from "@/lib/mail";

/** وصف مبسط للجهاز من User-Agent (للعرض فقط). */
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return "جهاز غير معروف";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "متصفح";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "نظام غير معروف";
  return `${browser} على ${os}`;
}

/**
 * يقرر هل الدخول من جهاز جديد: لا توجد جلسة سابقة (خلال 180 يومًا) بنفس User-Agent،
 * مع وجود جلسات سابقة أصلًا (أول دخول للحساب لا يُعتبر جهازًا جديدًا).
 */
export async function isNewDevice(db: Db, userId: string, currentSessionId: string, ua: string | null | undefined) {
  if (!ua) return false;
  const since = new Date(Date.now() - 180 * 86_400_000);
  const base = { userId, id: { not: currentSessionId }, createdAt: { gte: since } };
  const [any, same] = await Promise.all([
    db.session.count({ where: base }),
    db.session.count({ where: { ...base, userAgent: ua.slice(0, 300) } }),
  ]);
  return any > 0 && same === 0;
}

/** يرسل إيميل «دخول من جهاز جديد» في الخلفية — لا يؤخر الدخول ولا يفشله أبدًا. */
export function alertNewDevice(db: Db, userId: string, sessionToken: string, meta: RequestMeta, send = sendMail): void {
  if (!mailConfigured()) return;
  void (async () => {
    const s = await db.session.findUnique({ where: { tokenHash: hashToken(sessionToken) }, select: { id: true } });
    if (!s || !(await isNewDevice(db, userId, s.id, meta.userAgent))) return;
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
    if (!user) return;
    const when = new Intl.DateTimeFormat("ar-SA-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" }).format(new Date());
    const body = brandedEmail({
      title: "دخول من جهاز جديد",
      lines: [`هلا ${user.name}،`, "تم تسجيل الدخول لحسابك في ZAKI Smart ERP من جهاز ما استخدمته قبل:", `الجهاز: ${describeDevice(meta.userAgent)}`, `الوقت: ${when} (بتوقيت الرياض)`, ...(meta.ip ? [`عنوان IP: ${meta.ip}`] : [])],
      button: { label: "مراجعة حسابي", url: appUrl("/account") },
      footer: "لو هذا أنت، ما عليك شي. لو مو أنت: غيّر كلمة المرور فورًا وبلّغ مسؤول النظام.",
    });
    await send({ to: user.email, subject: "تنبيه أمني: دخول من جهاز جديد", ...body });
  })().catch((e) => console.error("[login-alert] failed", e instanceof Error ? e.message : e));
}
