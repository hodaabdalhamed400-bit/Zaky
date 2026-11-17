import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { cookieSecure, env } from "@/lib/env";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { sessionMaxAgeHours, validateSession } from "./session";
import { resolveClientIp } from "@/lib/client-ip";
import { mustEnrollMfa } from "@/services/mfa.service";
import type { Actor, RequestMeta } from "./actor";

import { mfaCookieName, sessionCookieName } from "./cookie-names";

const SESSION_COOKIE = () => sessionCookieName(cookieSecure());
const MFA_COOKIE = () => mfaCookieName(cookieSecure());

export async function getRequestMeta(): Promise<RequestMeta> {
  const h = await headers();
  const ip = resolveClientIp(
    { xff: h.get("x-forwarded-for"), realIp: h.get("x-real-ip"), cfConnectingIp: h.get("cf-connecting-ip") },
    env().TRUSTED_PROXY_HOPS,
  );
  return { ip, userAgent: h.get("user-agent") };
}

export async function setSessionCookie(token: string, persistent = false) {
  (await cookies()).set(SESSION_COOKIE(), token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: sessionMaxAgeHours(persistent) * 3600,
  });
}

/** كوكي مؤقتة (5 دقائق) لمرحلة رمز التحقق الثنائي فقط — لا تمنح أي صلاحية. */
export async function setMfaCookie(token: string) {
  (await cookies()).set(MFA_COOKIE(), token, { httpOnly: true, secure: cookieSecure(), sameSite: "lax", path: "/", maxAge: 5 * 60 });
}
export async function getMfaCookie() {
  return (await cookies()).get(MFA_COOKIE())?.value;
}
export async function clearMfaCookie() {
  (await cookies()).delete(MFA_COOKIE());
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE());
}

/** المستخدم الحالي (أو null) — مخزن مؤقتًا لكل طلب. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE())?.value;
  return validateSession(prisma, token);
});

/**
 * للصفحات: يتطلب تسجيل الدخول (وصلاحية اختيارية)، وإلا يعيد التوجيه.
 * يفرض تغيير كلمة المرور المؤقتة قبل استخدام النظام.
 */
export async function requirePageActor(perm?: PermissionKey, opts: { allowPasswordChange?: boolean; allowMfaSetup?: boolean } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword && !opts.allowPasswordChange) redirect("/account?first=1");
  if (!opts.allowPasswordChange && !opts.allowMfaSetup && (await mustEnrollMfa(prisma, actor))) redirect("/account/mfa?required=1");
  if (perm && !actor.permissions.has(perm)) redirect("/forbidden");
  return actor;
}

/** لإجراءات الخادم (Server Actions): يتطلب جلسة صالحة ولا يسمح بالعمل قبل تغيير كلمة المرور المؤقتة. */
export async function requireActionActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/account?first=1");
  if (await mustEnrollMfa(prisma, actor)) redirect("/account/mfa?required=1");
  return actor;
}

export type FormState = { error?: string; success?: string };
