"use server";
import { prisma } from "@/lib/db";
import { getActor, getRequestMeta } from "@/lib/auth/server";
import { redirect } from "next/navigation";
import { toSafeMessage } from "@/lib/errors";
import { beginEnrollment, confirmEnrollment } from "@/services/mfa.service";

export type EnrollState = { qrSvg?: string; secret?: string; codes?: string[]; error?: string };

async function actor() {
  const a = await getActor();
  if (!a) redirect("/login");
  if (a.mustChangePassword) redirect("/account?first=1");
  return a;
}

export async function enrollAction(prev: EnrollState, fd: FormData): Promise<EnrollState> {
  const a = await actor();
  try {
    if (fd.get("step") === "start") {
      const r = await beginEnrollment(prisma, a);
      return { qrSvg: r.qrSvg, secret: r.secret };
    }
    const r = await confirmEnrollment(prisma, a, String(fd.get("code") ?? ""), await getRequestMeta());
    return { codes: r.recoveryCodes };
  } catch (e) {
    return { ...prev, error: toSafeMessage(e) };
  }
}
