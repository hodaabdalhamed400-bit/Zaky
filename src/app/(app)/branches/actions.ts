"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { createBranch, createFloor, deleteFloor, updateBranch } from "@/services/branches.service";

function readBranch(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    code: s("code"),
    nameAr: s("nameAr"),
    city: s("city"),
    address: s("address"),
    mapUrl: s("mapUrl"),
    managerName: s("managerName"),
    managerActing: fd.get("managerActing") === "on",
    contactPerson: s("contactPerson"),
    phone: s("phone"),
    notes: s("notes"),
    status: s("status"),
  };
}

export async function createBranchAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let id: string;
  try {
    id = (await createBranch(prisma, actor, readBranch(fd), await getRequestMeta())).id;
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/branches");
  redirect(`/branches/${id}?saved=1`);
}

export async function updateBranchAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await updateBranch(prisma, actor, id, readBranch(fd), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/branches");
  redirect(`/branches/${id}?saved=1`);
}

export async function createFloorAction(branchId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await createFloor(prisma, actor, branchId, { name: String(fd.get("name") ?? ""), level: String(fd.get("level") ?? "0") }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/branches/${branchId}`);
  return { success: "تمت إضافة الدور" };
}

export async function deleteFloorAction(floorId: string, branchId: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await deleteFloor(prisma, actor, floorId, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/branches/${branchId}`);
  return { success: "تم حذف الدور" };
}
