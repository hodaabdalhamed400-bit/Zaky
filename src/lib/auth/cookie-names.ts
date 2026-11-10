/**
 * اسم كوكي الجلسة. في الإنتاج (HTTPS) نستخدم البادئة __Host- التي يفرض المتصفح معها:
 * Secure، و Path=/، وعدم وجود Domain — فلا يمكن لنطاق فرعي آخر زرع أو استبدال الجلسة.
 * ملف خفيف بلا تبعيات حتى يُستخدم في middleware (Edge).
 */
export const SESSION_COOKIE_SECURE = "__Host-zaki_session";
export const SESSION_COOKIE_DEV = "zaki_session";
export const sessionCookieName = (secure: boolean) => (secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE_DEV);
export const MFA_COOKIE_SECURE = "__Host-zaki_mfa";
export const MFA_COOKIE_DEV = "zaki_mfa";
export const mfaCookieName = (secure: boolean) => (secure ? MFA_COOKIE_SECURE : MFA_COOKIE_DEV);
