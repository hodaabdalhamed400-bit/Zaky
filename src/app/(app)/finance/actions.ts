"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { approvePayment, createAdjustment, recordPayment, rejectPayment, reversePayment } from "@/services/payments.service";
import { uploadDocument } from "@/services/documents.service";

export async function recordPaymentAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let allocations: unknown = [];
  try {
    allocations = JSON.parse(String(fd.get("allocations") ?? "[]"));
  } catch {
    allocations = [];
  }
  let id: string;
  try {
    const p = await recordPayment(
      prisma,
      actor,
      {
        contractId: String(fd.get("contractId") ?? ""),
        amount: String(fd.get("amount") ?? ""),
        method: String(fd.get("method") ?? ""),
        referenceNo: String(fd.get("referenceNo") ?? ""),
        paidOn: String(fd.get("paidOn") ?? ""),
        notes: String(fd.get("notes") ?? ""),
        idempotencyKey: String(fd.get("idempotencyKey") ?? ""),
        allocations,
      },
      await getRequestMeta(),
    );
    id = p!.id;
    // إثبات الدفع (اختياري) يُرفع بعد إنشاء الدفعة
    const f = fd.get("proof");
    if (f instanceof File && f.size > 0) {
      try {
        await uploadDocument(prisma, actor, { file: { name: f.name, size: f.size, bytes: new Uint8Array(await f.arrayBuffer()) }, category: "PAYMENT_PROOF", owner: { paymentId: id } }, await getRequestMeta());
      } catch (e) {
        revalidatePath("/finance");
        redirect(`/finance/payments/${id}?done=recorded&proofError=${encodeURIComponent(toSafeMessage(e))}`);
      }
    }
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/finance");
  redirect(`/finance/payments/${id}?done=recorded`);
}

export async function paymentOpAction(id: string, op: "approve" | "reject" | "reverse", _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  const meta = await getRequestMeta();
  const reason = String(fd.get("reason") ?? "");
  try {
    if (op === "approve") await approvePayment(prisma, actor, id, meta);
    else if (op === "reject") await rejectPayment(prisma, actor, id, reason, meta);
    else await reversePayment(prisma, actor, id, reason, meta);
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/finance");
  revalidatePath(`/finance/payments/${id}`);
  redirect(`/finance/payments/${id}?done=${op}`);
}

export async function adjustmentAction(contractId: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await createAdjustment(prisma, actor, { scheduleId: String(fd.get("scheduleId") ?? ""), type: String(fd.get("type") ?? ""), amount: String(fd.get("amount") ?? ""), reason: String(fd.get("reason") ?? "") }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/contracts/${contractId}`);
  return { success: "تم تسجيل التسوية" };
}
