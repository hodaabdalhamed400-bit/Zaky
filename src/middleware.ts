import { NextResponse, type NextRequest } from "next/server";

/**
 * فحص أولي سريع فقط: وجود كوكي الجلسة. التحقق الحقيقي من الجلسة والصلاحيات
 * يتم على الخادم في كل صفحة وإجراء (requirePageActor / الخدمات).
 */
const PUBLIC = ["/login", "/api/health", "/api/cron"]; // /api/cron محمي بسر خاص

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("zaki_session")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt|brand/).*)"],
};
