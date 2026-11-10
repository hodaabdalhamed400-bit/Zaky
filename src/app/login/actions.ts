"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clearMfaCookie, getMfaCookie, getRequestMeta, setMfaCookie, setSessionCookie } from "@/lib/auth/server";
import { login } from "@/services/auth.service";
import { verifyChallenge } from "@/services/mfa.service";
import { toSafeMessage } from "@/lib/errors";

export type LoginState = { error?: string; email?: string };

export async function loginAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const email = String(fd.get("email") ?? "");
  let next: string;
  try {
    const res = await login(prisma, { email, password: fd.get("password") }, await getRequestMeta());
    if (res.ok === false) return { error: res.error, email };
    if (res.ok === "mfa") {
      await setMfaCookie(res.challengeToken);
      next = "/login/mfa";
    } else {
      await setSessionCookie(res.token);
      next = res.mustChangePassword ? "/account?first=1" : "/";
    }
  } catch (e) {
    return { error: toSafeMessage(e), email };
  }
  redirect(next);
}

export type MfaState = { error?: string; restart?: boolean };

export async function mfaAction(_prev: MfaState, fd: FormData): Promise<MfaState> {
  let next: string;
  try {
    const res = await verifyChallenge(prisma, await getMfaCookie(), String(fd.get("code") ?? ""), await getRequestMeta());
    if (!res.ok) {
      if (res.restart) await clearMfaCookie();
      return { error: res.error, restart: res.restart };
    }
    await clearMfaCookie();
    await setSessionCookie(res.token);
    next = res.usedRecovery ? `/account/mfa?recoveryUsed=${res.remainingRecovery}` : "/";
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  redirect(next);
}
