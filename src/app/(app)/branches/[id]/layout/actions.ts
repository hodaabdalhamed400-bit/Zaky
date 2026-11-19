"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { resetBranchLayout, saveBranchLayout } from "@/services/branch-scene.service";

export async function saveLayoutAction(branchId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    let items: unknown = [];
    try {
      items = JSON.parse(String(fd.get("layout") ?? "[]"));
    } catch {
      return { error: "بيانات المخطط غير صالحة" };
    }
    const r = await saveBranchLayout(prisma, actor, branchId, items, await getRequestMeta());
    revalidatePath(`/branches/${branchId}/3d`);
    return { success: `تم حفظ مخطط ${r.saved} وحدة` };
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
}

export async function resetLayoutAction(branchId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await resetBranchLayout(prisma, actor, branchId, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/branches/${branchId}/3d`);
  redirect(`/branches/${branchId}/layout`);
}
