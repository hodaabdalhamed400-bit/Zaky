"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clearMfaCookie, getMfaCookie, getRequestMeta, setMfaCookie, setSessionCookie } from "@/lib/auth/server";
import { login } from "@/services/auth.service";
import { verifyChallenge } from "@/services/mfa.service";
import { toSafeMessage } from "@/lib/errors";
import { requestPasswordReset, resetPasswordWithToken } from "@/services/password-reset.service";
import { alertNewDevice } from "@/services/login-alerts.service";

export type LoginState = { error?: string; email?: string };

export async function loginAction(_prev: LoginState, fd: FormData): Promise<LoginState> {
  const email = String(fd.get("email") ?? "");
  let next: string;
  try {
    const meta = await getRequestMeta();
    const res = await login(prisma, { email, password: fd.get("password"), remember: fd.get("remember") }, meta);
    if (res.ok === false) return { error: res.error, email };
    if (res.ok === "mfa") {
      await setMfaCookie(res.challengeToken);
      next = "/login/mfa";
    } else {
      await setSessionCookie(res.token, res.persistent);
      alertNewDevice(prisma, res.userId, res.token, meta);
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
    const meta = await getRequestMeta();
    const res = await verifyChallenge(prisma, await getMfaCookie(), String(fd.get("code") ?? ""), meta);
    if (!res.ok) {
      if (res.restart) await clearMfaCookie();
      return { error: res.error, restart: res.restart };
    }
    await clearMfaCookie();
    await setSessionCookie(res.token, res.persistent);
    alertNewDevice(prisma, res.userId, res.token, meta);
    next = res.usedRecovery ? `/account/mfa?recoveryUsed=${res.remainingRecovery}` : "/";
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  redirect(next);
}

export type ForgotState = { error?: string; sent?: string; email?: string };

export async function forgotAction(_prev: ForgotState, fd: FormData): Promise<ForgotState> {
  const email = String(fd.get("email") ?? "");
  try {
    const res = await requestPasswordReset(prisma, email, await getRequestMeta());
    return res.ok ? { sent: res.message } : { error: res.error, email };
  } catch (e) {
    return { error: toSafeMessage(e), email };
  }
}

export type ResetState = { error?: string; expired?: boolean };

export async function resetAction(_prev: ResetState, fd: FormData): Promise<ResetState> {
  try {
    const res = await resetPasswordWithToken(
      prisma,
      { token: fd.get("token"), newPassword: fd.get("newPassword"), confirmPassword: fd.get("confirmPassword") },
      await getRequestMeta(),
    );
    if (!res.ok) return { error: res.error, expired: res.expired };
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  redirect("/login?reset=1");
}
