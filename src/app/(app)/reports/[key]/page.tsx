import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { todayInRiyadh } from "@/lib/dates";
import { REPORTS, canViewReport, runReport, type Column } from "@/services/reports.service";
import { Alert, Card, EmptyState, buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { StatCard } from "@/components/ui/stat-card";
import { ReportTable, formatCell } from "@/components/reports/report-table";
import { reportMeta } from "@/components/reports/report-meta";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: REPORTS[key]?.title ?? "تقرير" };
}
const PREVIEW = 300;
type Tone = "default" | "good" | "warn" | "bad";

const TILE_TONE: Record<string, Tone> = { overdue: "bad", collected: "good", amount: "good", due: "warn" };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

/** فترات جاهزة محسوبة بتوقيت الرياض. */
function datePresets(today: string) {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const mi = m - 1;
  return [
    { label: "هذا الشهر", from: iso(y, mi, 1), to: today },
    { label: "الشهر الماضي", from: iso(y, mi - 1, 1), to: iso(y, mi, 0) },
    { label: "آخر 3 أشهر", from: iso(y, mi - 2, 1), to: today },
    { label: "هذه السنة", from: `${y}-01-01`, to: today },
  ];
}

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
  const meta = reportMeta(key);
  const f = r.filters;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const link = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/${key}?${s}` : `/reports/${key}`;
  };
  const branchName = branches.find((b) => b.id === f.branchId)?.nameAr ?? null;
  const statusLabel = f.status && def.statuses ? (def.statuses[f.status] ?? null) : null;
  const canExport = actor.permissions.has("reports.export");
  const hasDates = def.filters.includes("dateRange");
  const presets = hasDates ? datePresets(todayInRiyadh()) : [];
  const anyFilter = !!(f.branchId || f.status || f.from || f.to);

  // مربعات الملخص: من سطر الإجمالي (أرقام ومبالغ فقط)
  const tiles: { c: Column; v: string }[] = r.totals
    ? r.columns
        .filter((c, i) => i > 0 && (c.type === "money" || c.type === "int") && r.totals![c.key] !== undefined && r.totals![c.key] !== null)
        .sort((a, b) => (a.type === b.type ? 0 : a.type === "money" ? -1 : 1))
        .slice(0, 3)
        .map((c) => ({ c, v: formatCell(c, r.totals![c.key]) }))
    : [];

  const activeChips = [
    branchName && { label: `الفرع: ${branchName}`, clear: { branchId: undefined } },
    statusLabel && { label: `الحالة: ${statusLabel}`, clear: { status: undefined } },
    (f.from || f.to) && { label: `الفترة: ${f.from ?? "…"} ← ${f.to ?? "…"}`, clear: { from: undefined, to: undefined } },
  ].filter(Boolean) as { label: string; clear: Record<string, undefined> }[];

  return (
    <>
      <nav className="animate-fade-in mb-3 text-sm" aria-label="مسار التنقل">
        <Link href="/reports" className="inline-flex items-center gap-1 text-gray-500 transition-colors hover:text-brand-900">
          <Icon name="arrowLeft" className="size-4 rotate-180" />
          كل التقارير
        </Link>
      </nav>

      <div className="animate-fade-up mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <span className={cx("grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg", meta.tone)}>
            <Icon name={meta.icon} className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-brand-900 sm:text-[1.7rem]">{def.title}</h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-500">{def.description}</p>
          </div>
        </div>
        {canExport && (
          <div className="flex flex-wrap gap-2">
            <a href={`/api/reports/${key}?${qs}`} className={buttonClass("primary")}>
              <Icon name="receipt" className="size-4" />
              تصدير Excel
            </a>
            <a href={`/print/reports/${key}?${qs}`} className={buttonClass("secondary")}>
              <Icon name="reports" className="size-4" />
              PDF / طباعة
            </a>
          </div>
        )}
      </div>

      <Card className="mb-5">
        <form className="flex flex-wrap items-end gap-3 p-4" role="search" aria-label="مرشحات التقرير">
          {def.filters.includes("branch") && (
            <div className="min-w-48 flex-1 sm:flex-none">
              <label htmlFor="branchId" className="mb-1 block text-xs font-medium text-gray-500">الفرع</label>
              <select id="branchId" name="branchId" defaultValue={f.branchId ?? ""} className={inputClass}>
                <option value="">كل الفروع المتاحة لي</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
              </select>
            </div>
          )}
          {def.filters.includes("status") && def.statuses && (
            <div className="min-w-44 flex-1 sm:flex-none">
              <label htmlFor="status" className="mb-1 block text-xs font-medium text-gray-500">الحالة</label>
              <select id="status" name="status" defaultValue={f.status ?? ""} className={inputClass}>
                <option value="">الكل</option>
                {Object.entries(def.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          )}
          {hasDates && (
            <>
              <div className="min-w-40 flex-1 sm:flex-none">
                <label htmlFor="from" className="mb-1 block text-xs font-medium text-gray-500">{def.dateLabel ?? "الفترة"}: من</label>
                <input id="from" name="from" type="date" defaultValue={f.from} className={inputClass} />
              </div>
              <div className="min-w-40 flex-1 sm:flex-none">
                <label htmlFor="to" className="mb-1 block text-xs font-medium text-gray-500">إلى</label>
                <input id="to" name="to" type="date" defaultValue={f.to} className={inputClass} />
              </div>
            </>
          )}
          <button className={buttonClass("primary")}>
            <Icon name="search" className="size-4" />
            عرض
          </button>
          {anyFilter && (
            <Link href={`/reports/${key}`} className={buttonClass("ghost")}>مسح المرشحات</Link>
          )}
        </form>
        {hasDates && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-4 py-3" aria-label="فترات جاهزة">
            <span className="me-1 text-xs text-gray-400">فترة سريعة:</span>
            {presets.map((p) => {
              const on = f.from === p.from && f.to === p.to;
              return (
                <Link
                  key={p.label}
                  href={link({ from: p.from, to: p.to })}
                  aria-current={on ? "true" : undefined}
                  className={cx(
                    "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-all duration-200",
                    on ? "bg-brand-900 text-white shadow-md ring-brand-900" : "bg-white text-gray-700 ring-gray-200 hover:text-brand-900 hover:ring-accent-500/50",
                  )}
                >
                  {p.label}
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <div className="stagger mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="عدد السجلات" value={r.rows.length.toLocaleString("en")} hint={r.truncated ? "تم الاقتطاع عند 5000" : undefined} icon={meta.icon} />
        {tiles.map(({ c, v }) => (
          <StatCard key={c.key} label={c.header} value={v} hint="إجمالي جميع السجلات" icon={c.type === "money" ? "finance" : "reports"} tone={TILE_TONE[c.key] ?? "default"} />
        ))}
      </div>

      {r.note && <div className="mb-3"><Alert kind="info">{r.note}</Alert></div>}
      {r.truncated && <div className="mb-3"><Alert kind="warning">النتائج تتجاوز 5000 سجل؛ ضيّق المرشحات.</Alert></div>}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
            <span className="h-4 w-1 rounded-full bg-gradient-to-b from-accent-500 to-brand-700" aria-hidden="true" />
            النتائج
            <span className="tabular rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{r.rows.length.toLocaleString("en")}</span>
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {activeChips.length === 0 ? (
              <span className="text-xs text-gray-400">كل الفروع المتاحة · بدون مرشحات</span>
            ) : (
              activeChips.map((c) => (
                <Link key={c.label} href={link(c.clear)} className="group/chip inline-flex items-center gap-1.5 rounded-full bg-accent-50 px-2.5 py-1 text-xs font-medium text-accent-700 ring-1 ring-accent-600/20 transition-colors hover:bg-accent-100" title="إزالة هذا المرشح">
                  {c.label}
                  <Icon name="close" className="size-3 opacity-60 group-hover/chip:opacity-100" />
                </Link>
              ))
            )}
          </div>
        </div>
        {r.rows.length === 0 ? (
          <EmptyState icon={meta.icon} title="لا توجد بيانات مطابقة" description="جرّب فترة أوسع أو اختر «كل الفروع»." action={anyFilter ? <Link href={`/reports/${key}`} className={buttonClass("secondary")}>مسح المرشحات</Link> : undefined} />
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <ReportTable columns={r.columns} rows={r.rows.slice(0, PREVIEW)} totals={r.totals} />
          </div>
        )}
      </Card>
      {r.rows.length > PREVIEW && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500">
          <Icon name="alert" className="size-3.5" />
          يُعرض أول {PREVIEW} سجل؛ التصدير يشمل جميع السجلات ({r.rows.length.toLocaleString("en")}). الإجمالي محسوب على جميع السجلات.
        </p>
      )}
    </>
  );
}
