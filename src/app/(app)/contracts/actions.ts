"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import {
  approveContract, cancelContract, createContract, createRenewalDraft, rejectContract, submitForApproval, terminateContract, updateDraft, updateTerms,
} from "@/services/contracts.service";

function readContract(fd: FormData) {
  let units: unknown = [];
  try {
    units = JSON.parse(String(fd.get("units") ?? "[]"));
  } catch {
    units = [];
  }
  const s = (k: string) => String(fd.get(k) ?? "");
  return {
    tenantId: s("tenantId"),
    branchId: s("branchId"),
    startDate: s("startDate"),
    durationMonths: s("durationMonths"),
    billingCycle: s("billingCycle"),
    units,
    discountAmount: s("discountAmount") || "0",
    terms: s("terms"),
    notes: s("notes"),
  };
}

const done = (id: string, flag: string) => {
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${id}`);
  redirect(`/contracts/${id}?done=${flag}`);
};

export async function createContractAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let id: string;
  try {
    id = (await createContract(prisma, actor, readContract(fd), await getRequestMeta())).id;
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  done(id, "created");
  return {};
}

export async function updateDraftAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await updateDraft(prisma, actor, id, readContract(fd), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  done(id, "saved");
  return {};
}

export async function updateTermsAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await updateTerms(prisma, actor, id, { terms: String(fd.get("terms") ?? ""), notes: String(fd.get("notes") ?? ""), reason: String(fd.get("reason") ?? "") }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  done(id, "saved");
  return {};
}

type Op = "submit" | "approve" | "reject" | "cancel" | "renew" | "terminate";

export async function contractOpAction(id: string, op: Op, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  const meta = await getRequestMeta();
  const reason = String(fd.get("reason") ?? "");
  let target = id;
  try {
    if (op === "submit") await submitForApproval(prisma, actor, id, meta);
    else if (op === "approve") await approveContract(prisma, actor, id, meta);
    else if (op === "reject") await rejectContract(prisma, actor, id, reason, meta);
    else if (op === "cancel") await cancelContract(prisma, actor, id, reason, meta);
    else if (op === "renew") target = (await createRenewalDraft(prisma, actor, id, meta)).id;
    else if (op === "terminate")
      await terminateContract(prisma, actor, id, { exitDate: String(fd.get("exitDate") ?? ""), policy: String(fd.get("policy") ?? ""), reason }, meta);
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/contracts/${id}`);
  done(target, op);
  return {};
}
