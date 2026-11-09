import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { BILLING_CYCLE_LABELS } from "@/lib/contract-pricing";
import { CONTRACT_STATUS_LABELS, getContract } from "@/services/contracts.service";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "نسخة العقد للطباعة" };

/** نسخة قابلة للطباعة/الحفظ PDF من المتصفح (تدعم العربية بالكامل). ليست توقيعًا إلكترونيًا معتمدًا. */
export default async function PrintContract({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("contracts.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { contract: c } = await getContract(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: c.tenantId }, select: { name: true, crNumber: true, vatNumber: true, mobile: true, nationalAddress: true } });
  const cell = "border border-gray-300 px-3 py-2";
  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-gray-900 print:p-0">
      <style>{`@media print { @page { size: A4; margin: 15mm; } body { background: #fff; } }`}</style>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <PrintButton />
        <a href={`/contracts/${id}`} className="text-sm text-brand-700 hover:underline">العودة للعقد</a>
      </div>
      <header className="flex items-start justify-between border-b-2 border-brand-900 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" className="h-16 w-auto" />
        <div className="text-end">
          <h1 className="text-xl font-bold">عقد إيجار مساحة عمل</h1>
          <p dir="ltr" className="font-mono text-sm">{c.contractNo}</p>
          <p className="text-xs text-gray-500">الحالة: {CONTRACT_STATUS_LABELS[c.status]}</p>
        </div>
      </header>
      {c.status !== "ACTIVE" && <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-center text-xs">نسخة غير نهائية — حالة العقد: {CONTRACT_STATUS_LABELS[c.status]}</p>}

      <h2 className="mt-6 mb-2 font-bold text-brand-900">الطرفان</h2>
      <table className="w-full border-collapse">
        <tbody>
          <tr><th className={cell + " w-40 bg-gray-50 text-start"}>الطرف الأول</th><td className={cell}>شركة ذكي لحاضنات ومسرعات الأعمال — فرع {c.branch.nameAr}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>الطرف الثاني</th><td className={cell}>{tenant.name}{tenant.crNumber ? ` — سجل تجاري ${tenant.crNumber}` : ""}{tenant.vatNumber ? ` — رقم ضريبي ${tenant.vatNumber}` : ""}</td></tr>
          {tenant.nationalAddress && <tr><th className={cell + " bg-gray-50 text-start"}>العنوان الوطني</th><td className={cell}>{tenant.nationalAddress}</td></tr>}
        </tbody>
      </table>

      <h2 className="mt-6 mb-2 font-bold text-brand-900">الوحدات المؤجرة</h2>
      <table className="w-full border-collapse">
        <thead><tr className="bg-gray-50"><th className={cell + " text-start"}>الوحدة</th><th className={cell + " text-start"}>النوع</th><th className={cell + " text-start"}>المقاعد</th><th className={cell + " text-start"}>الإيجار الشهري</th></tr></thead>
        <tbody>{c.units.map((u) => <tr key={u.id}><td className={cell}>{u.unit.code}</td><td className={cell}>{u.unit.unitType.nameAr}</td><td className={cell}>{u.seats}</td><td className={cell}>{formatSAR(u.price)}</td></tr>)}</tbody>
      </table>

      <h2 className="mt-6 mb-2 font-bold text-brand-900">المدة والقيمة</h2>
      <table className="w-full border-collapse">
        <tbody>
          <tr><th className={cell + " w-48 bg-gray-50 text-start"}>مدة العقد</th><td className={cell}>{c.durationMonths} شهرًا، من {formatDate(c.startDate)} إلى {formatDate(c.endDate)}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>دورة الدفع</th><td className={cell}>{BILLING_CYCLE_LABELS[c.billingCycle]} — يستحق كل قسط في يوم بداية العقد من كل دورة</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>إجمالي قيمة العقد</th><td className={cell}>{formatSAR(c.totalAmount)} شاملة ضريبة القيمة المضافة ({formatSAR(c.vatAmount)}){c.discountAmount.gt(0) ? `، بعد خصم ${formatSAR(c.discountAmount)}` : ""}</td></tr>
          <tr><th className={cell + " bg-gray-50 text-start"}>الخروج المبكر</th><td className={cell}>لا يُسترد باقي قيمة العقد المدفوع، وتُحدد الأقساط المتبقية حسب الاتفاق مع الشركة</td></tr>
        </tbody>
      </table>

      {c.schedules.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 font-bold text-brand-900">جدول الأقساط</h2>
          <table className="w-full border-collapse text-xs">
            <thead><tr className="bg-gray-50"><th className={cell}>#</th><th className={cell}>تاريخ الاستحقاق</th><th className={cell}>المبلغ</th></tr></thead>
            <tbody>{c.schedules.filter((s) => s.status !== "CANCELLED").map((s) => <tr key={s.id}><td className={cell}>{s.seqNo}</td><td className={cell}>{formatDate(s.dueDate)}</td><td className={cell}>{formatSAR(s.amountDue)}</td></tr>)}</tbody>
          </table>
        </>
      )}

      {c.terms && (<><h2 className="mt-6 mb-2 font-bold text-brand-900">الشروط الخاصة</h2><p className="whitespace-pre-line">{c.terms}</p></>)}

      <div className="mt-12 grid grid-cols-2 gap-10 text-center">
        <div><p className="font-semibold">الطرف الأول</p><p className="mt-12 border-t border-gray-400 pt-1 text-xs text-gray-500">الاسم والتوقيع والختم</p></div>
        <div><p className="font-semibold">الطرف الثاني</p><p className="mt-12 border-t border-gray-400 pt-1 text-xs text-gray-500">الاسم والتوقيع</p></div>
      </div>
      <footer className="mt-10 border-t border-gray-200 pt-2 text-[10px] text-gray-400">
        أُنشئت هذه النسخة من ZAKI Smart ERP في {formatDateTime(new Date())}. هذه الوثيقة لا تُعد توقيعًا إلكترونيًا معتمدًا، ويلزم توقيعها يدويًا ورفع النسخة الموقعة في النظام.
      </footer>
    </div>
  );
}
