"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, setSessionCookie } from "@/lib/auth/server";
import { login } from "@/services/auth.service";
import { toSafeMessage } from "@/lib/errors";

export type LoginState = { error?: string; email?: string };

export async function loginAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const email = String(fd.get("email") ?? "");
  let mustChange = false;
  try {
    const res = await login(prisma, { email, password: fd.get("password") }, await getRequestMeta());
    if (!res.ok) return { error: res.error, email };
    await setSessionCookie(res.token);
    mustChange = res.mustChangePassword;
  } catch (e) {
    return { error: toSafeMessage(e), email };
  }
  redirect(mustChange ? "/account?first=1" : "/");
}
