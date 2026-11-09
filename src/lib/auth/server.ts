import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { cookieSecure, env } from "@/lib/env";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { validateSession } from "./session";
import type { Actor, RequestMeta } from "./actor";

export const SESSION_COOKIE = "zaki_session";

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  let ip: string | null = null;
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const hops = env().TRUSTED_PROXY_HOPS;
    ip = hops > 0 ? (parts[Math.max(0, parts.length - hops)] ?? null) : null;
  }
  ip ??= h.get("x-real-ip");
  return { ip, userAgent: h.get("user-agent") };
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: env().SESSION_MAX_AGE_HOURS * 3600,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** المستخدم الحالي (أو null) — مخزن مؤقتًا لكل طلب. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSession(prisma, token);
});

/**
 * للصفحات: يتطلب تسجيل الدخول (وصلاحية اختيارية)، وإلا يعيد التوجيه.
 * يفرض تغيير كلمة المرور المؤقتة قبل استخدام النظام.
 */
export async function requirePageActor(perm?: PermissionKey, opts: { allowPasswordChange?: boolean } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword && !opts.allowPasswordChange) redirect("/account?first=1");
  if (perm && !actor.permissions.has(perm)) redirect("/forbidden");
  return actor;
}

/** لإجراءات الخادم (Server Actions): يتطلب جلسة صالحة ولا يسمح بالعمل قبل تغيير كلمة المرور المؤقتة. */
export async function requireActionActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/account?first=1");
  return actor;
}

export type FormState = { error?: string; success?: string };
