import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_DEV, SESSION_COOKIE_SECURE } from "@/lib/auth/cookie-names";

/**
 * 1) فحص أولي سريع لوجود كوكي الجلسة (التحقق الحقيقي على الخادم في كل صفحة وإجراء).
 * 2) سياسة أمان المحتوى (CSP) بـ nonce عشوائي لكل طلب: لا تُنفذ إلا سكربتات Next الموقّعة،
 *    فيُمنع تنفيذ أي سكربت محقون (XSS) حتى لو وصل إلى الصفحة.
 */
const PUBLIC = ["/login", "/api/health", "/api/cron"]; // /login يشمل /login/mfa؛ /api/cron محمي بسر خاص

function csp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // أنماط مضمنة تستخدمها المكتبات (الرسوم البيانية)
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const hasSession = !!(req.cookies.get(SESSION_COOKIE_SECURE)?.value || req.cookies.get(SESSION_COOKIE_DEV)?.value);
  // واجهات API بلا جلسة: رفض صريح 401 بدل إعادة التوجيه لصفحة الدخول
  if (!isPublic && !hasSession && pathname.startsWith("/api/")) {
    return new NextResponse("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  if (!isPublic && !hasSession && pathname !== "/login/mfa") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  const nonce = btoa(crypto.randomUUID());
  const policy = csp(nonce);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy); // يقرأه Next ليضيف nonce لسكربتاته
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|brand/).*)"],
};
