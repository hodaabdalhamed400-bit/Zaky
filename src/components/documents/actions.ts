"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { deleteDocument, uploadDocument } from "@/services/documents.service";

type Owner = { tenantId: string } | { contractId: string } | { unitId: string } | { paymentId: string } | { purchaseInvoiceId: string };

export async function uploadDocumentAction(owner: Owner, revalidate: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    const f = fd.get("file");
    const file = f instanceof File && f.size > 0 ? { name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) } : null;
    await uploadDocument(prisma, actor, { file, category: fd.get("category"), isSensitive: fd.get("isSensitive") === "on", owner }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(revalidate);
  return { success: "تم رفع المستند" };
}

export async function deleteDocumentAction(id: string, revalidate: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await deleteDocument(prisma, actor, id, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(revalidate);
  return {};
}
