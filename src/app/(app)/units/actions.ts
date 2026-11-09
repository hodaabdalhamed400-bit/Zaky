"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { createUnit, createUnitType, setUnitArchived, setUnitTypeActive, updateUnit } from "@/services/units.service";

function readUnit(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    branchId: s("branchId"),
    floorId: s("floorId"),
    unitTypeId: s("unitTypeId"),
    code: s("code"),
    areaSqm: s("areaSqm"),
    capacity: s("capacity"),
    basePrice: s("basePrice"),
    pricingCycle: s("pricingCycle"),
    description: s("description"),
    status: s("status"),
  };
}

export async function createUnitAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let id: string;
  try {
    id = (await createUnit(prisma, actor, readUnit(fd), await getRequestMeta())).id;
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/units");
  redirect(fd.get("another") === "1" ? `/units/new?branchId=${fd.get("branchId")}&added=${randomUUID().slice(0, 4)}` : `/units/${id}?saved=1`);
}

export async function updateUnitAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await updateUnit(prisma, actor, id, readUnit(fd), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/units");
  redirect(`/units/${id}?saved=1`);
}

export async function archiveUnitAction(id: string, archived: boolean, _prev: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await setUnitArchived(prisma, actor, id, archived, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/units");
  revalidatePath(`/units/${id}`);
  return { success: archived ? "تمت أرشفة الوحدة" : "تمت استعادة الوحدة" };
}

export async function createUnitTypeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await createUnitType(prisma, actor, { nameAr: String(fd.get("nameAr") ?? ""), occupancyMode: String(fd.get("occupancyMode") ?? ""), leaseMode: String(fd.get("leaseMode") ?? "LEASE") }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/units/types");
  return { success: "تمت إضافة النوع" };
}

export async function toggleUnitTypeAction(id: string, isActive: boolean, _prev: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await setUnitTypeActive(prisma, actor, id, isActive, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/units/types");
  return {};
}
