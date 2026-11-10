import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { BOOKING_PAYMENT_COLOR, BOOKING_PAYMENT_LABELS, getBooking } from "@/services/bookings.service";
import { PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABELS } from "@/services/payments.service";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ReasonOp } from "../../contracts/op-forms";
import { BookingPaymentForm } from "../forms";
import { bookingPaymentAction, cancelBookingAction } from "../actions";

export const metadata: Metadata = { title: "تفاصيل الحجز" };

export default async function BookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const actor = await requirePageActor("bookings.view");
  const { id } = await params;
  const { done } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { booking: b, userNames } = await getBooking(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const active = b.status === "CONFIRMED";
  const openPayment = b.payments.some((p) => p.status === "PENDING_REVIEW" || p.status === "APPROVED");
  const row = (l: string, v: React.ReactNode) => <div><dt className="text-gray-500">{l}</dt><dd className="mt-1">{v}</dd></div>;
  return (
    <>
      <PageHeader title={`الحجز ${b.bookingNo}`} description={`${b.unit.code} · ${b.branch.nameAr}`} />
      {done === "created" && <div className="mb-4"><Alert kind="success">تم الحجز.{b.chargeAmount.gt(0) ? ` عليه ${formatSAR(b.chargeAmount)} للساعات الزائدة.` : " ضمن الساعات المجانية."}</Alert></div>}
      {done === "cancelled" && <div className="mb-4"><Alert kind="success">تم إلغاء الحجز وإعادة الساعات المجانية.</Alert></div>}
      {!active && <div className="mb-4"><Alert kind="warning">ملغى: {b.cancelReason}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="بيانات الحجز" action={active ? <Badge color={BOOKING_PAYMENT_COLOR[b.paymentStatus]}>{BOOKING_PAYMENT_LABELS[b.paymentStatus]}</Badge> : <Badge>ملغى</Badge>} />
          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
            {row("العميل", b.tenant ? <Link href={`/tenants/${b.tenant.id}`} className="text-brand-700 hover:underline">{b.tenant.name}</Link> : `${b.visitorName} (زائر)`)}
            {row("الجوال", <span dir="ltr" className="tabular">{b.tenant?.mobile ?? b.visitorMobile ?? "—"}</span>)}
            {row("القاعة", b.unit.code)}
            {row("التاريخ", <span className="tabular">{formatDate(b.bookingDate)}</span>)}
            {row("الوقت", <span className="tabular">{b.startHour}:00 – {b.endHour}:00 ({b.hours} ساعة)</span>)}
            {row("الساعات المجانية / المدفوعة", <span className="tabular">{b.freeHours} / {b.paidHours}</span>)}
            {row("سعر الساعة", <span className="tabular">{formatSAR(b.hourlyPrice)}</span>)}
            {row("المبلغ المستحق", <span className="tabular font-semibold">{formatSAR(b.chargeAmount)}</span>)}
            {b.notes && <div className="sm:col-span-3">{row("ملاحظات", b.notes)}</div>}
            <div className="text-xs text-gray-400 sm:col-span-3">
              حجزه {b.createdById ? userNames[b.createdById] : "—"} في {formatDateTime(b.createdAt)}
              {b.cancelledById && ` · ألغاه ${userNames[b.cancelledById]} في ${formatDateTime(b.cancelledAt)}`}
            </div>
          </dl>
        </Card>
        <div className="space-y-6">
          {active && b.paymentStatus === "UNPAID" && !openPayment && actor.permissions.has("payments.record") && (
            <Card>
              <CardHeader title={`تحصيل ${formatSAR(b.chargeAmount)}`} />
              <div className="p-5"><BookingPaymentForm action={bookingPaymentAction.bind(null, b.id)} idempotencyKey={randomUUID()} today={todayInRiyadh()} /></div>
            </Card>
          )}
          {b.payments.length > 0 && (
            <Card>
              <CardHeader title="الدفعات" />
              <ul className="divide-y divide-gray-100 text-sm">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between px-5 py-3">
                    <Link href={`/finance/payments/${p.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{p.receiptNo ?? "بانتظار المراجعة"}</Link>
                    <Badge color={PAYMENT_STATUS_COLOR[p.status]}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {active && !openPayment && actor.permissions.has("bookings.manage") && (
            <Card>
              <CardHeader title="إلغاء الحجز" />
              <div className="space-y-2 p-5">
                <p className="text-xs text-gray-500">متاح قبل موعد الحجز وما لم تُسجل له دفعة. تعود الساعات المجانية للعميل.</p>
                <ReasonOp action={cancelBookingAction.bind(null, b.id)} label="إلغاء الحجز" placeholder="سبب الإلغاء…" variant="danger" />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
