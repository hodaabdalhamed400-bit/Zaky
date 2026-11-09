"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getActor, getRequestMeta, setSessionCookie } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { changeOwnPassword } from "@/services/auth.service";

export type PwState = { error?: string; success?: string };

export async function changePasswordAction(_prev: PwState, fd: FormData): Promise<PwState> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const wasForced = actor.mustChangePassword;
  try {
    const { token } = await changeOwnPassword(
      prisma,
      actor,
      {
        currentPassword: String(fd.get("currentPassword") ?? ""),
        newPassword: String(fd.get("newPassword") ?? ""),
        confirmPassword: String(fd.get("confirmPassword") ?? ""),
      },
      await getRequestMeta(),
    );
    await setSessionCookie(token);
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  if (wasForced) redirect("/");
  return { success: "تم تغيير كلمة المرور وإنهاء الجلسات الأخرى." };
}
