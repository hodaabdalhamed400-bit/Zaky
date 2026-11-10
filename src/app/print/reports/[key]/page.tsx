import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { formatDateTime } from "@/lib/dates";
import { runReport } from "@/services/reports.service";
import { ReportTable, filtersSummary } from "@/components/reports/report-table";
import { PrintButton } from "../../contracts/[id]/print-button";

export const metadata: Metadata = { title: "تقرير للطباعة" };

/**
 * نسخة PDF للتقرير: صفحة مهيأة للطباعة A4 أفقي يحفظها المتصفح PDF.
 * هذا الأسلوب يضمن عرض العربية بشكل صحيح (تشكيل الحروف والاتجاه) دون مكتبات خادم إضافية.
 */
export default async function PrintReport({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor("reports.export");
  const { key } = await params;
  const sp = await searchParams;
  const r = await runReport(prisma, actor, key, sp, { forExport: true }).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    if (e instanceof AppError && e.status === 403) redirect("/forbidden");
    throw e;
  });
  const branch = r.filters.branchId ? await prisma.branch.findUnique({ where: { id: r.filters.branchId }, select: { nameAr: true } }) : null;
  await writeAudit(prisma, { actorId: actor.id, action: "report.export", entityType: "report", entityId: key, branchId: r.filters.branchId ?? null, after: { format: "pdf", filters: r.filters, rows: r.rows.length }, meta: await getRequestMeta() });
  return (
    <div className="mx-auto bg-white p-6 text-gray-900 print:p-0">
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm; } thead { display: table-header-group; } }`}</style>
      <div className="mb-4 flex justify-between print:hidden">
        <PrintButton />
        <a href={`/reports/${key}`} className="text-sm text-brand-700 hover:underline">العودة للتقرير</a>
      </div>
      <header className="mb-4 flex items-start justify-between border-b-2 border-brand-900 pb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" className="h-12 w-auto" />
        <div className="text-end">
          <h1 className="text-lg font-bold">{r.def.title}</h1>
          <p className="text-xs text-gray-600">{filtersSummary(r.filters, branch?.nameAr ?? null, r.filters.status && r.def.statuses ? (r.def.statuses[r.filters.status] ?? null) : null)}</p>
          <p className="text-[10px] text-gray-400">أعدّه {actor.name} · {formatDateTime(new Date())} · {r.rows.length} سجل</p>
        </div>
      </header>
      {r.rows.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">لا توجد بيانات مطابقة.</p> : <ReportTable columns={r.columns} rows={r.rows} totals={r.totals} compact />}
      {r.note && <p className="mt-3 text-[10px] text-gray-500">{r.note}</p>}
      <footer className="mt-4 border-t border-gray-200 pt-1 text-[9px] text-gray-400">ZAKI Smart ERP — تقرير داخلي. المبالغ بالريال السعودي شاملة ضريبة القيمة المضافة ما لم يُذكر غير ذلك.</footer>
    </div>
  );
}
