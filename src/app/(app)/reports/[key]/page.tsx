import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { REPORTS, canViewReport, runReport } from "@/services/reports.service";
import { Alert, Card, PageHeader, buttonClass, inputClass } from "@/components/ui/primitives";
import { ReportTable, filtersSummary } from "@/components/reports/report-table";

export const metadata: Metadata = { title: "تقرير" };
const PREVIEW = 300;

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor("reports.view");
  const { key } = await params;
  const sp = await searchParams;
  const def = REPORTS[key];
  if (!def) notFound();
  if (!canViewReport(actor, key)) redirect("/forbidden");
  const [r, branches] = await Promise.all([
    runReport(prisma, actor, key, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const qs = new URLSearchParams(Object.entries(r.filters).filter(([, v]) => v) as [string, string][]).toString();
  const branchName = branches.find((b) => b.id === r.filters.branchId)?.nameAr ?? null;
  const canExport = actor.permissions.has("reports.export");
  return (
    <>
      <PageHeader
        title={def.title}
        description={def.description}
        actions={
          canExport ? (
            <>
              <a href={`/api/reports/${key}?${qs}`} className={buttonClass("primary")}>تصدير Excel</a>
              <a href={`/print/reports/${key}?${qs}`} className={buttonClass("secondary")}>PDF / طباعة</a>
            </>
          ) : undefined
        }
      />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          {def.filters.includes("branch") && (
            <div>
              <label htmlFor="branchId" className="mb-1 block text-xs text-gray-500">الفرع</label>
              <select id="branchId" name="branchId" defaultValue={r.filters.branchId ?? ""} className={inputClass.replace("w-full", "w-48")}>
                <option value="">كل الفروع المتاحة لي</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
              </select>
            </div>
          )}
          {def.filters.includes("status") && def.statuses && (
            <div>
              <label htmlFor="status" className="mb-1 block text-xs text-gray-500">الحالة</label>
              <select id="status" name="status" defaultValue={r.filters.status ?? ""} className={inputClass.replace("w-full", "w-44")}>
                <option value="">الكل</option>
                {Object.entries(def.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}
          {def.filters.includes("dateRange") && (
            <>
              <div>
                <label htmlFor="from" className="mb-1 block text-xs text-gray-500">{def.dateLabel ?? "الفترة"}: من</label>
                <input id="from" name="from" type="date" defaultValue={r.filters.from} className={inputClass.replace("w-full", "w-40")} />
              </div>
              <div>
                <label htmlFor="to" className="mb-1 block text-xs text-gray-500">إلى</label>
                <input id="to" name="to" type="date" defaultValue={r.filters.to} className={inputClass.replace("w-full", "w-40")} />
              </div>
            </>
          )}
          <button className={buttonClass("secondary")}>عرض</button>
        </form>
      </Card>
      <p className="mb-2 text-xs text-gray-500">{filtersSummary(r.filters, branchName, r.filters.status && def.statuses ? (def.statuses[r.filters.status] ?? null) : null)} · {r.rows.length} سجل</p>
      {r.note && <div className="mb-3"><Alert kind="info">{r.note}</Alert></div>}
      {r.truncated && <div className="mb-3"><Alert kind="warning">النتائج تتجاوز 5000 سجل؛ ضيّق المرشحات.</Alert></div>}
      <Card>
        {r.rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">لا توجد بيانات مطابقة للمرشحات.</p>
        ) : (
          <div className="overflow-x-auto">
            <ReportTable columns={r.columns} rows={r.rows.slice(0, PREVIEW)} totals={r.totals} />
          </div>
        )}
      </Card>
      {r.rows.length > PREVIEW && <p className="mt-2 text-xs text-gray-500">يُعرض أول {PREVIEW} سجل؛ التصدير يشمل جميع السجلات ({r.rows.length}). الإجمالي محسوب على جميع السجلات.</p>}
    </>
  );
}
