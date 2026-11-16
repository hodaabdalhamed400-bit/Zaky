import type { Metadata } from "next";
import Link from "next/link";
import { requirePageActor } from "@/lib/auth/server";
import { REPORTS, canViewReport } from "@/services/reports.service";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { FILTER_LABELS, REPORT_GROUPS, reportMeta } from "@/components/reports/report-meta";

export const metadata: Metadata = { title: "التقارير" };

export default async function ReportsPage() {
  const actor = await requirePageActor("reports.view");
  const canExport = actor.permissions.has("reports.export");
  const list = Object.entries(REPORTS)
    .filter(([k]) => canViewReport(actor, k))
    .map(([key, d]) => ({ key, d, m: reportMeta(key) }));
  const groups = REPORT_GROUPS.map((g) => ({ ...g, items: list.filter((x) => x.m.group === g.key) })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title="التقارير"
        description={canExport ? "اختر تقريرًا لعرضه، وفلتره حسب الفرع والفترة، ثم صدّره إلى Excel أو PDF بالعربية." : "اعرض التقارير المتاحة لصلاحياتك (التصدير غير متاح لدورك)."}
      />

      <div className="stagger mb-8 flex flex-wrap gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1.5 font-medium text-brand-800 ring-1 ring-brand-100">
          <Icon name="reports" className="size-3.5" />
          <span className="tabular">{list.length}</span> تقرير متاح لك
        </span>
        <span className={cx("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium ring-1", canExport ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-gray-50 text-gray-500 ring-gray-200")}>
          <Icon name={canExport ? "check" : "key"} className="size-3.5" />
          {canExport ? "التصدير إلى Excel وPDF متاح" : "عرض فقط"}
        </span>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon="reports" title="لا توجد تقارير متاحة لدورك" description="اطلب من مدير النظام منحك صلاحية العرض للأقسام التي تحتاج تقاريرها." />
        </Card>
      ) : (
        <div className="space-y-9">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 id={`g-${g.key}`} className="flex items-center gap-2 text-base font-semibold text-brand-900">
                  <span className="h-4 w-1 rounded-full bg-gradient-to-b from-accent-500 to-brand-700" aria-hidden="true" />
                  {g.title}
                </h2>
                {g.hint && <p className="text-xs text-gray-400">{g.hint}</p>}
              </div>
              <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {g.items.map(({ key, d, m }) => (
                  <li
                    key={key}
                    data-report-card
                    className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-accent-500/40 hover:shadow-[0_18px_36px_-16px_rgb(19_46_75/0.3)]"
                  >
                    <div className="pointer-events-none absolute -top-12 -start-12 size-32 rounded-full bg-accent-500/5 blur-2xl transition-transform duration-500 group-hover:scale-150" aria-hidden="true" />
                    <div className="relative mb-4 flex items-start gap-3.5">
                      <span className={cx("grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110", m.tone)}>
                        <Icon name={m.icon} className="size-5" />
                      </span>
                      <div className="min-w-0">
                        <Link href={`/reports/${key}`} className="font-semibold text-gray-900 after:absolute after:inset-0 after:content-[''] group-hover:text-brand-900">
                          {d.title}
                        </Link>
                        <p className="mt-1 text-sm leading-relaxed text-gray-500">{d.description}</p>
                      </div>
                    </div>
                    <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-gray-100 pt-3.5">
                      <div className="flex flex-wrap gap-1.5" aria-label="المرشحات المتاحة">
                        {d.filters.map((f) => (
                          <span key={f} className="rounded-md bg-gray-50 px-2 py-0.5 text-[11px] text-gray-500 ring-1 ring-gray-100">{FILTER_LABELS[f]}</span>
                        ))}
                      </div>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 transition-colors group-hover:text-accent-700">
                        عرض
                        <Icon name="arrowLeft" className="size-4 transition-transform duration-300 group-hover:-translate-x-1" />
                      </span>
                    </div>
                    <div className={cx("absolute inset-x-0 bottom-0 h-0.5 origin-right scale-x-0 bg-gradient-to-l transition-transform duration-500 group-hover:scale-x-100", m.bar)} aria-hidden="true" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
