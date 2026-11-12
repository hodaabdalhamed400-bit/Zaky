import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatSAR } from "@/lib/money";
import { getFinanceSummary } from "@/services/finance.service";
import { Alert, Card, CardHeader, LinkButton, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { OccupancyRing } from "@/components/ui/occupancy-ring";
import { Icon } from "@/components/ui/icons";

const BILLED = "#2a78d6";
const COLLECTED = "#1eadc0";

/** أعمدة شهرية متحركة: المستحق مقابل المحصّل (لكل عمود تلميح بالقيمة، والجدول التفصيلي أسفل الصفحة) */
function MonthlyBars({ data }: { data: { month: string; billed: string; collected: string }[] }) {
  const max = Math.max(1, ...data.flatMap((m) => [Number(m.billed), Number(m.collected)]));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-gray-600" aria-label="وسيلة الإيضاح">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: BILLED }} />أقساط مستحقة في الشهر</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: COLLECTED }} />المحصّل في الشهر</span>
      </div>
      <div className="flex h-44 items-end gap-1.5 border-b border-gray-200 sm:gap-3" role="img" aria-label="المستحق مقابل المحصّل لآخر 12 شهرًا — الأرقام في الجدول أسفل الصفحة">
        {data.map((m, i) => (
          <div key={m.month} className="group flex h-full flex-1 flex-col justify-end">
            <div className="flex h-full items-end justify-center gap-[2px]">
              {[{ v: Number(m.billed), c: BILLED, k: "مستحق" }, { v: Number(m.collected), c: COLLECTED, k: "محصّل" }].map((b) => (
                <div
                  key={b.k}
                  title={`${monthName(m.month)} — ${b.k}: ${formatSAR(b.k === "مستحق" ? m.billed : m.collected)}`}
                  className="w-full max-w-4 origin-bottom rounded-t-[4px] transition-opacity duration-200 group-hover:opacity-80"
                  style={{ height: `${(b.v / max) * 100}%`, minHeight: b.v > 0 ? 3 : 0, background: b.c, animation: `grow-y 0.8s cubic-bezier(0.22,1,0.36,1) ${i * 40}ms both` }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5 sm:gap-3">
        {data.map((m) => (
          <span key={m.month} className="flex-1 truncate text-center text-[10px] text-gray-500">{MONTHS[Number(m.month.slice(5, 7)) - 1]!.slice(0, 3)}</span>
        ))}
      </div>
    </div>
  );
}

export const metadata: Metadata = { title: "التحصيل والمستحقات" };

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
function change(cur: string, base: string) {
  const b = Number(base);
  if (!b) return null;
  return Math.round(((Number(cur) - b) / b) * 1000) / 10;
}

export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor("payments.view");
  const sp = await searchParams;
  const [s, branches] = await Promise.all([
    getFinanceSummary(prisma, actor, sp),
    prisma.branch.findMany({ where: { status: { not: "INACTIVE" }, ...branchWhere(actor, "id") }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const mPrev = change(s.collected.current, s.collected.previous);
  const mLy = change(s.collected.current, s.collected.lastYear);
  const pct = (v: number | null) => (v === null ? "لا توجد قاعدة مقارنة" : `${v > 0 ? "+" : ""}${v}%`);

  return (
    <>
      <PageHeader
        title="التحصيل والمستحقات"
        description={`الفترة: ${monthName(s.filters.month)}`}
        actions={
          <>
            <LinkButton href="/finance/overdue" variant="secondary" icon="alert">المتأخرات</LinkButton>
            <LinkButton href="/finance/payments" variant="secondary">الدفعات</LinkButton>
            {actor.permissions.has("payments.record") && <LinkButton href="/finance/payments/new" icon="plus">تسجيل دفعة</LinkButton>}
          </>
        }
      />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="month" className="mb-1 block text-xs text-gray-500">الشهر</label>
            <input id="month" name="month" type="month" defaultValue={s.filters.month} className={inputClass.replace("w-full", "w-44")} />
          </div>
          {branches.length > 1 && (
            <div>
              <label htmlFor="branch" className="mb-1 block text-xs text-gray-500">الفرع</label>
              <select id="branch" name="branchId" defaultValue={s.filters.branchId ?? ""} className={inputClass.replace("w-full", "w-48")}>
                <option value="">كل الفروع المتاحة لي</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
              </select>
            </div>
          )}
          <button className={buttonClass("primary")}>عرض</button>
        </form>
      </Card>

      {s.pending.count > 0 && (
        <div className="mb-6">
          <Alert kind="warning">
            يوجد {s.pending.count} دفعة بانتظار المراجعة بقيمة {formatSAR(s.pending.amount)} — لا تُحتسب في المحصّل حتى اعتمادها.{" "}
            <Link href="/finance/payments?status=PENDING_REVIEW" className="font-semibold underline">مراجعتها</Link>
          </Alert>
        </div>
      )}

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="المحصّل في الشهر" value={formatSAR(s.collected.current)} hint={`مقابل الشهر السابق: ${pct(mPrev)}`} icon="finance" tone="good" />
        <StatCard label="المستحق حتى اليوم" value={formatSAR(s.due)} hint="أقساط حلّ موعدها ولم تُسدد" icon="finance" />
        <StatCard label="المتأخر" value={formatSAR(s.overdue)} hint="تجاوز يوم استحقاقه" icon="alert" tone="bad" />
        <StatCard label="أقساط مستقبلية" value={formatSAR(s.future)} hint="لم يحل موعدها" icon="contracts" />
        <StatCard label="قيمة العقود النشطة" value={formatSAR(s.contractValue)} hint="التزام تعاقدي، ليس نقدًا ولا إيرادًا" icon="contracts" />
        <StatCard label="الإيراد المحاسبي للشهر (تقديري)" value={formatSAR(s.revenueNet)} hint="صافي بدون ضريبة، موزع على أيام الفترة" icon="reports" />
        <StatCard label="المحصّل في نفس الشهر العام الماضي" value={formatSAR(s.collected.lastYear)} hint={`التغير: ${pct(mLy)}`} icon="reports" />
        <StatCard label="إجمالي التسويات والخصومات" value={formatSAR(s.adjusted)} hint="مخفضة من المستحقات" icon="finance" />
      </div>

      {(() => {
        const cur = s.byMonth.find((m) => m.month === s.filters.month);
        const rate = cur && Number(cur.billed) > 0 ? Math.round((Number(cur.collected) / Number(cur.billed)) * 1000) / 10 : null;
        return (
          <Card className="mt-6">
            <div className="grid gap-6 p-5 lg:grid-cols-[16rem_1fr]">
              <div className="flex flex-col items-center justify-center gap-3 text-center lg:border-e lg:border-gray-100 lg:pe-6">
                <OccupancyRing pct={rate === null ? null : Math.min(100, rate)} size={132} stroke={11} label="نسبة التحصيل" />
                <div>
                  <p className="text-sm font-semibold text-brand-900">{monthName(s.filters.month)}</p>
                  <p className="tabular text-xs text-gray-500">{cur ? `${formatSAR(cur.collected)} من ${formatSAR(cur.billed)}` : "لا توجد أقساط في هذا الشهر"}</p>
                </div>
                <div className="flex w-full flex-col gap-2">
                  <Link href="/finance/overdue" className="group flex items-center justify-between rounded-xl bg-red-50 px-3 py-2 text-xs ring-1 ring-red-100 transition-colors hover:bg-red-100">
                    <span className="flex items-center gap-1.5 font-medium text-red-800"><Icon name="alert" className="size-4" />المتأخرات</span>
                    <span className="tabular font-bold text-red-700">{formatSAR(s.overdue)}</span>
                  </Link>
                  {s.pending.count > 0 && (
                    <Link href="/finance/payments?status=PENDING_REVIEW" className="flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2 text-xs ring-1 ring-amber-100 transition-colors hover:bg-amber-100">
                      <span className="font-medium text-amber-900">بانتظار المراجعة</span>
                      <span className="tabular font-bold text-amber-800">{s.pending.count}</span>
                    </Link>
                  )}
                </div>
              </div>
              <div>
                <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-gray-900">
                  <span className="h-4 w-1 rounded-full bg-gradient-to-b from-accent-500 to-brand-700" aria-hidden="true" />
                  آخر 12 شهرًا
                </h2>
                <MonthlyBars data={s.byMonth} />
              </div>
            </div>
          </Card>
        );
      })()}

      <details className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-800">كيف تُحسب هذه الأرقام؟</summary>
        <ul className="mt-2 list-disc space-y-1 ps-5">
          <li><b>قيمة العقود</b> إجمالي العقود النشطة شاملة الضريبة — التزام تعاقدي.</li>
          <li><b>المستحقات</b> أقساط حلّ موعدها ولم تُسدد بعد خصم التسويات. <b>المتأخر</b> ما تجاوز يوم استحقاقه (بلا مهلة سماح).</li>
          <li><b>المحصّل</b> الدفعات المعتمدة فقط حسب تاريخ الدفع، شاملة الضريبة. المعلقة والمرفوضة والمعكوسة لا تُحتسب.</li>
          <li><b>الإيراد المحاسبي</b> تقدير: صافي الإيجار بدون ضريبة موزعًا على أيام فترة كل قسط، بغض النظر عن السداد. النظام ليس نظامًا محاسبيًا معتمدًا ولا يصدر فواتير ضريبية.</li>
        </ul>
      </details>

      <div className="stagger mt-6 grid gap-6">
        <Card>
          <CardHeader title="حسب الفرع" />
          <Table>
            <thead><tr><Th>الفرع</Th><Th>المحصّل في الشهر</Th><Th>المستحق</Th><Th>المتأخر</Th><Th>القادم</Th></tr></thead>
            <tbody>
              {s.byBranch.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <Td><Link href={`/finance?branchId=${b.id}&month=${s.filters.month}`} className="text-brand-700 hover:underline">{b.name}</Link></Td>
                  <Td className="tabular whitespace-nowrap">{formatSAR(b.collected)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatSAR(b.due)}</Td>
                  <Td className={"tabular whitespace-nowrap " + (Number(b.overdue) > 0 ? "text-red-700" : "")}>{formatSAR(b.overdue)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatSAR(b.future)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="آخر 12 شهرًا: المستحق مقابل المحصّل" />
          <Table>
            <thead><tr><Th>الشهر</Th><Th>أقساط مستحقة فيه</Th><Th>المحصّل فيه</Th><Th>النسبة</Th></tr></thead>
            <tbody>
              {[...s.byMonth].reverse().map((m) => (
                <tr key={m.month}>
                  <Td>{monthName(m.month)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatSAR(m.billed)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatSAR(m.collected)}</Td>
                  <Td className="tabular">{Number(m.billed) > 0 ? `${Math.round((Number(m.collected) / Number(m.billed)) * 100)}%` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="border-t border-gray-100 px-5 py-2 text-xs text-gray-400">النسبة تقريبية: المحصّل في الشهر قد يخص أقساط أشهر أخرى.</p>
        </Card>
      </div>
    </>
  );
}
