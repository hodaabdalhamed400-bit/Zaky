import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, getPayment, payerName } from "@/services/payments.service";
import { PrintButton } from "../../contracts/[id]/print-button";

export const metadata: Metadata = { title: "إيصال استلام" };

/** إيصال داخلي — ليس فاتورة ضريبية ولا يغني عن نظام الفوترة الإلكترونية المعتمد. */
export default async function ReceiptPrint({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("payments.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { payment: p, userNames } = await getPayment(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  if (!p.receiptNo || (p.status !== "APPROVED" && p.status !== "REVERSED")) notFound();
  const cell = "border border-gray-300 px-3 py-2";
  return (
    <div className="mx-auto max-w-[148mm] bg-white p-8 text-[13px] text-gray-900 print:p-0">
      <style>{`@media print { @page { size: A5; margin: 12mm; } }`}</style>
      <div className="mb-6 flex justify-between print:hidden"><PrintButton /><a href={`/finance/payments/${id}`} className="text-sm text-brand-700 hover:underline">العودة</a></div>
      <header className="flex items-start justify-between border-b-2 border-brand-900 pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" className="h-12 w-auto" />
        <div className="text-end">
          <h1 className="text-lg font-bold">إيصال استلام</h1>
          <p dir="ltr" className="font-mono text-sm">{p.receiptNo}</p>
          <p className="text-xs text-gray-500">فرع {p.branch.nameAr}</p>
        </div>
      </header>
      {p.status === "REVERSED" && <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-center font-bold text-red-700">ملغى بالعكس — {p.reversalReason}</p>}
      <table className="mt-5 w-full border-collapse">
        <tbody>
          <tr><th className={cell + " w-36 bg-gray-50 text-start"}>استلمنا من</th><td className={cell}>{payerName(p)}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>مبلغ وقدره</th><td className={cell + " text-base font-bold"}>{formatSAR(p.amount)}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>وذلك عن</th><td className={cell}>{p.booking ? `حجز القاعة ${p.booking.unit.code} (${p.booking.bookingNo}) بتاريخ ${formatDate(p.booking.bookingDate)} من ${p.booking.startHour}:00 إلى ${p.booking.endHour}:00 — ${p.booking.paidHours} ساعة` : `أقساط العقد ${p.contract?.contractNo}: ${p.allocations.map((a) => `القسط ${a.schedule.seqNo} (${formatDate(a.schedule.dueDate)}): ${formatSAR(a.amount)}`).join("، ")}`}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>طريقة الدفع</th><td className={cell}>{PAYMENT_METHOD_LABELS[p.method]}{p.referenceNo ? ` — مرجع ${p.referenceNo}` : ""}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>تاريخ الدفع</th><td className={cell}>{formatDate(p.paidOn)}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>اعتمده</th><td className={cell}>{p.approvedById ? userNames[p.approvedById] : "—"} — {formatDateTime(p.approvedAt)}</td></tr>
        </tbody>
      </table>
      <p className="mt-10 text-center text-xs text-gray-500">التوقيع: ____________________</p>
      <footer className="mt-8 border-t border-gray-200 pt-2 text-[10px] leading-relaxed text-gray-400">
        إيصال داخلي صادر من ZAKI Smart ERP. المبالغ شاملة ضريبة القيمة المضافة. هذا الإيصال ليس فاتورة ضريبية ولا يغني عن الفاتورة الإلكترونية المعتمدة من هيئة الزكاة والضريبة والجمارك.
      </footer>
    </div>
  );
}
