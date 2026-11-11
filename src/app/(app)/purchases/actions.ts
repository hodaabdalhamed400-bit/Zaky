"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import {
  approvePurchase,
  createCategory,
  createPurchase,
  markPurchasePaid,
  markPurchaseUnpaid,
  rejectPurchase,
  setCategoryActive,
  updatePurchase,
} from "@/services/purchases.service";

const isRedirect = (e: unknown) => !!e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");

const fields = (fd: FormData) => ({
  categoryId: String(fd.get("categoryId") ?? ""),
  supplierName: String(fd.get("supplierName") ?? ""),
  supplierVatNo: String(fd.get("supplierVatNo") ?? ""),
  invoiceNo: String(fd.get("invoiceNo") ?? ""),
  invoiceDate: String(fd.get("invoiceDate") ?? ""),
  totalAmount: String(fd.get("totalAmount") ?? ""),
  vatAmount: String(fd.get("vatAmount") ?? ""),
  description: String(fd.get("description") ?? ""),
});

export async function createPurchaseAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let target: string;
  try {
    const f = fd.get("file");
    const file = f instanceof File && f.size > 0 ? { name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    const { invoice, uploadError } = await createPurchase(prisma, actor, { branchId: String(fd.get("branchId") ?? ""), ...fields(fd) }, file, await getRequestMeta());
    target = `/purchases/${invoice.id}?done=created${uploadError ? `&uploadError=${encodeURIComponent(uploadError)}` : ""}`;
  } catch (e) {
    if (isRedirect(e)) throw e;
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/purchases");
  redirect(target);
}

export async function updatePurchaseAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await updatePurchase(prisma, actor, id, fields(fd), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/purchases");
  redirect(`/purchases/${id}?done=updated`);
}

export async function purchaseOpAction(id: string, op: "approve" | "reject" | "paid" | "unpaid", _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  const meta = await getRequestMeta();
  const reason = String(fd.get("reason") ?? "");
  try {
    if (op === "approve") await approvePurchase(prisma, actor, id, meta);
    else if (op === "reject") await rejectPurchase(prisma, actor, id, reason, meta);
    else if (op === "paid") await markPurchasePaid(prisma, actor, id, { method: String(fd.get("method") ?? ""), paidOn: String(fd.get("paidOn") ?? "") }, meta);
    else await markPurchaseUnpaid(prisma, actor, id, reason, meta);
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/purchases");
  revalidatePath(`/purchases/${id}`);
  redirect(`/purchases/${id}?done=${op}`);
}

export async function createCategoryAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await createCategory(prisma, actor, fd.get("nameAr"), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/purchases/categories");
  return { success: "تمت إضافة التصنيف" };
}

export async function toggleCategoryAction(id: string, isActive: boolean, _p: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await setCategoryActive(prisma, actor, id, isActive, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/purchases/categories");
  return {};
}
