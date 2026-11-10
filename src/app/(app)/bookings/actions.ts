"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { cancelBooking, createBooking } from "@/services/bookings.service";
import { recordBookingPayment } from "@/services/payments.service";

export async function createBookingAction(_p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  const s = (k: string) => String(fd.get(k) ?? "");
  let id: string;
  try {
    id = (
      await createBooking(
        prisma,
        actor,
        { unitId: s("unitId"), date: s("date"), startHour: s("startHour"), hours: s("hours"), customerType: s("customerType"), tenantId: s("tenantId"), visitorName: s("visitorName"), visitorMobile: s("visitorMobile"), notes: s("notes") },
        await getRequestMeta(),
      )
    ).id;
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/bookings");
  redirect(`/bookings/${id}?done=created`);
}

export async function cancelBookingAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await cancelBooking(prisma, actor, id, String(fd.get("reason") ?? ""), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/bookings");
  redirect(`/bookings/${id}?done=cancelled`);
}

export async function bookingPaymentAction(id: string, _p: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let pid: string;
  try {
    const p = await recordBookingPayment(
      prisma,
      actor,
      { bookingId: id, method: String(fd.get("method") ?? ""), referenceNo: String(fd.get("referenceNo") ?? ""), paidOn: String(fd.get("paidOn") ?? ""), notes: String(fd.get("notes") ?? ""), idempotencyKey: String(fd.get("idempotencyKey") ?? "") },
      await getRequestMeta(),
    );
    pid = p!.id;
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/bookings/${id}`);
  redirect(`/finance/payments/${pid}?done=recorded`);
}
