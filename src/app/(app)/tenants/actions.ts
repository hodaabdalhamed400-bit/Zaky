"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { AppError, toSafeMessage } from "@/lib/errors";
import { addContact, addInteraction, createTenant, removeContact, setTenantArchived, updateTenant } from "@/services/tenants.service";

export type TenantFormState = FormState & { duplicateSuspect?: boolean };

function readTenant(fd: FormData) {
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    type: s("type"),
    name: s("name"),
    contactPersonName: s("contactPersonName"),
    mobile: s("mobile"),
    email: s("email"),
    crNumber: s("crNumber"),
    nationalId: fd.has("nationalId") ? s("nationalId") : null,
    vatNumber: s("vatNumber"),
    nationalAddress: s("nationalAddress"),
    primaryBranchId: s("primaryBranchId"),
    status: s("status") || "PROSPECT",
    notes: s("notes"),
    confirmDuplicate: fd.get("confirmDuplicate") === "on",
  };
}

const fail = (e: unknown): TenantFormState => ({ error: toSafeMessage(e), duplicateSuspect: e instanceof AppError && e.code === "DUPLICATE_SUSPECT" });

export async function createTenantAction(_p: TenantFormState, fd: FormData): Promise<TenantFormState> {
  const actor = await requireActionActor();
  let id: string;
  try {
    id = (await createTenant(prisma, actor, readTenant(fd), await getRequestMeta())).id;
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/tenants");
  redirect(`/tenants/${id}?saved=1`);
}

export async function updateTenantAction(id: string, _p: TenantFormState, fd: FormData): Promise<TenantFormState> {
  const actor = await requireActionActor();
  try {
    await updateTenant(prisma, actor, id, readTenant(fd), await getRequestMeta());
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/tenants");
  redirect(`/tenants/${id}?saved=1`);
}

export async function archiveTenantAction(id: string, archived: boolean, _p: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await setTenantArchived(prisma, actor, id, archived, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/tenants/${id}`);
  return { success: archived ? "تمت أرشفة العميل" : "تمت استعادة العميل" };
}

export async function addContactAction(tenantId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await addContact(prisma, actor, tenantId, { name: String(fd.get("name") ?? ""), title: String(fd.get("title") ?? ""), mobile: String(fd.get("mobile") ?? ""), email: String(fd.get("email") ?? ""), isPrimary: fd.get("isPrimary") === "on" }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/tenants/${tenantId}`);
  return { success: "تمت إضافة جهة الاتصال" };
}

export async function removeContactAction(contactId: string, tenantId: string, _p: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await removeContact(prisma, actor, contactId, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/tenants/${tenantId}`);
  return {};
}

export async function addInteractionAction(tenantId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await addInteraction(prisma, actor, tenantId, { channel: String(fd.get("channel") ?? ""), body: String(fd.get("body") ?? "") });
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/tenants/${tenantId}`);
  return { success: "تم تسجيل التواصل" };
}
