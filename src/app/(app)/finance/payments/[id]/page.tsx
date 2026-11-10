import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABELS, getPayment, payerName } from "@/services/payments.service";
import { Alert, Badge, Card, CardHeader, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { OpButton, ReasonOp } from "../../../contracts/op-forms";
import { paymentOpAction } from "../../actions";

export const metadata: Metadata = { title: "تفاصيل الدفعة" };
const DONE: Record<string, string> = {
  recorded: "تم تسجيل الدفعة بانتظار المراجعة.",
  approve: "تم اعتماد الدفعة وإصدار الإيصال.",
  reject: "تم رفض الدفعة.",
  reverse: "تم عكس الدفعة واستبعادها من المسدد.",
};

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; proofError?: string }> }) {
  const actor = await requirePageActor("payments.view");
  const { id } = await params;
  const { done, proofError } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { payment: p, userNames } = await getPayment(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const can = (x: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(x);
  const op = (o: "approve" | "reject" | "reverse") => paymentOpAction.bind(null, id, o);
  const who = (uid: string | null, at: Date | null) => (uid ? `${userNames[uid] ?? "—"} · ${formatDateTime(at)}` : "—");

  return (
    <>
      <PageHeader
        title={p.receiptNo ? `الإيصال ${p.receiptNo}` : "دفعة بانتظار المراجعة"}
        description={`${payerName(p)} · ${p.branch.nameAr}`}
        actions={p.receiptNo && p.status === "APPROVED" ? <LinkButton href={`/print/receipts/${id}`} variant="secondary">طباعة الإيصال</LinkButton> : undefined}
      />
      {done && DONE[done] && <div className="mb-4"><Alert kind="success">{DONE[done]}</Alert></div>}
      {proofError && <div className="mb-4"><Alert kind="warning">سُجلت الدفعة، لكن تعذر رفع إثبات الدفع: {proofError}. يمكنك رفعه أدناه.</Alert></div>}
      {p.status === "REJECTED" && <div className="mb-4"><Alert>مرفوضة: {p.rejectedReason}</Alert></div>}
      {p.status === "REVERSED" && <div className="mb-4"><Alert kind="warning">معكوسة: {p.reversalReason}. مستبعدة من المسدد والمحصّل، والإيصال محفوظ للتدقيق.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="بيانات الدفعة" action={<Badge color={PAYMENT_STATUS_COLOR[p.status]}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>} />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
              <div><dt className="text-gray-500">المبلغ</dt><dd className="tabular mt-1 text-lg font-bold">{formatSAR(p.amount)}</dd></div>
              <div><dt className="text-gray-500">الوسيلة</dt><dd className="mt-1">{PAYMENT_METHOD_LABELS[p.method]}</dd></div>
              <div><dt className="text-gray-500">رقم المرجع</dt><dd dir="ltr" className="mt-1 text-end font-mono">{p.referenceNo ?? "—"}</dd></div>
              <div><dt className="text-gray-500">تاريخ الدفع</dt><dd className="tabular mt-1">{formatDate(p.paidOn)}</dd></div>
              <div><dt className="text-gray-500">العقد</dt><dd className="mt-1">{p.contract && <Link href={`/contracts/${p.contract.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{p.contract.contractNo}</Link>}</dd></div>
              <div><dt className="text-gray-500">الدافع</dt><dd className="mt-1">{p.tenant ? <Link href={`/tenants/${p.tenant.id}`} className="text-brand-700 hover:underline">{p.tenant.name}</Link> : payerName(p)}</dd></div>
              {p.booking && <div><dt className="text-gray-500">حجز قاعة</dt><dd className="mt-1"><Link href={`/bookings/${p.booking.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{p.booking.bookingNo}</Link></dd></div>}
              {p.notes && <div className="sm:col-span-3"><dt className="text-gray-500">ملاحظات</dt><dd className="mt-1">{p.notes}</dd></div>}
              <div className="space-y-0.5 text-xs text-gray-400 sm:col-span-3">
                <p>سجّلها: {who(p.recordedById, p.createdAt)}</p>
                {p.approvedById && <p>اعتمدها: {who(p.approvedById, p.approvedAt)}</p>}
                {p.rejectedById && <p>رفضها: {who(p.rejectedById, p.rejectedAt)}</p>}
                {p.reversedById && <p>عكسها: {who(p.reversedById, p.reversedAt)}</p>}
              </div>
            </dl>
          </Card>
          {p.booking && (
            <Card>
              <CardHeader title="تفاصيل الحجز" />
              <p className="p-5 text-sm text-gray-700">القاعة {p.booking.unit.code} · {formatDate(p.booking.bookingDate)} من {p.booking.startHour}:00 إلى {p.booking.endHour}:00 · {p.booking.paidHours} ساعة مدفوعة × {formatSAR(p.booking.hourlyPrice)}</p>
            </Card>
          )}
          {p.allocations.length > 0 && <Card>
            <CardHeader title="التوزيع على الأقساط" />
            <Table>
              <thead><tr><Th>القسط</Th><Th>الاستحقاق</Th><Th>الفترة</Th><Th>قيمة القسط</Th><Th>المبلغ المخصص</Th></tr></thead>
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.id}>
                    <Td className="tabular">#{a.schedule.seqNo}</Td>
                    <Td className="tabular whitespace-nowrap">{formatDate(a.schedule.dueDate)}</Td>
                    <Td className="tabular whitespace-nowrap text-xs text-gray-500">{formatDate(a.schedule.periodStart)} — {formatDate(a.schedule.periodEnd)}</Td>
                    <Td className="tabular whitespace-nowrap">{formatSAR(a.schedule.amountDue)}</Td>
                    <Td className="tabular whitespace-nowrap font-medium">{formatSAR(a.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>}
        </div>
        <div className="space-y-6">
          {(p.status === "PENDING_REVIEW" && can("payments.approve")) || (p.status === "APPROVED" && can("finance.adjust")) ? (
            <Card>
              <CardHeader title="المراجعة" />
              <div className="space-y-2 p-5">
                {p.status === "PENDING_REVIEW" && (
                  <>
                    <OpButton action={op("approve")} label="اعتماد وإصدار إيصال" confirm={`اعتماد دفعة بمبلغ ${formatSAR(p.amount)}؟ تأكد من وصول المبلغ فعليًا.`} />
                    <ReasonOp action={op("reject")} label="رفض الدفعة" placeholder="سبب الرفض…" variant="danger" />
                  </>
                )}
                {p.status === "APPROVED" && <ReasonOp action={op("reverse")} label="عكس الدفعة (تصحيح)" placeholder="سبب العكس: شيك مرتجع، خطأ إدخال…" variant="danger" />}
              </div>
            </Card>
          ) : null}
          <DocumentsPanel actor={actor} owner={{ paymentId: id }} path={`/finance/payments/${id}`} categories={["PAYMENT_PROOF", "OTHER"]} title="إثبات الدفع" />
        </div>
      </div>
    </>
  );
}
