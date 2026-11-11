import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { BRANCH_STATUS_COLOR as STATUS_COLOR, BRANCH_STATUS_LABELS, listBranches } from "@/services/branches.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, cx, inputClass, buttonClass } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { OccupancyBar, OccupancyBreakdown } from "@/components/ui/occupancy";
import { OccupancyRing } from "@/components/ui/occupancy-ring";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "الفروع" };

type Branch = Awaited<ReturnType<typeof listBranches>>["branches"][number];

function BranchCard({ b }: { b: Branch }) {
  const o = b.occupancy;
  const preparing = b.status === "PREPARING";
  const inactive = b.status === "INACTIVE";
  const available = o ? o.units - o.occupiedUnits : 0;
  return (
    <Link
      href={`/branches/${b.id}`}
      data-branch-card
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all duration-300 hover:-translate-y-1.5 hover:border-accent-500/40 hover:shadow-[0_22px_40px_-18px_rgb(19_46_75/0.35)] focus-visible:-translate-y-1.5"
    >
      {/* رأس البطاقة */}
      <div
        className={cx(
          "relative h-32 overflow-hidden p-5 text-white",
          preparing ? "bg-gradient-to-br from-[#3b4f66] to-[#24364a]" : inactive ? "bg-gradient-to-br from-gray-500 to-gray-700" : "bg-gradient-to-br from-brand-900 via-[#163a5c] to-[#0e2640]",
        )}
      >
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-70 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
        <div
          className={cx(
            "pointer-events-none absolute -top-16 -start-10 size-44 rounded-full blur-2xl transition-transform duration-700 group-hover:scale-150",
            preparing ? "bg-amber-400/25" : "bg-accent-500/30",
          )}
          aria-hidden="true"
        />
        <div className="relative flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-white/15 backdrop-blur">
            <span className="relative flex size-2">
              {b.status === "ACTIVE" && <span className="absolute inline-flex size-full animate-ping-soft rounded-full bg-emerald-400" />}
              <span className={cx("relative inline-flex size-2 rounded-full", b.status === "ACTIVE" ? "bg-emerald-400" : preparing ? "bg-amber-300" : "bg-gray-300")} />
            </span>
            {BRANCH_STATUS_LABELS[b.status]}
          </span>
          <span dir="ltr" className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-[11px] tracking-wider text-accent-100 ring-1 ring-white/10">{b.code}</span>
        </div>
        <h3 className="relative mt-3 text-2xl font-bold tracking-tight">{b.nameAr}</h3>
        <p className="relative mt-0.5 flex items-center gap-1 text-xs text-brand-100/80">
          <Icon name="pin" className="size-3.5" />
          {b.city ?? "مدينة غير محددة"}
        </p>
      </div>

      {/* الحلقة فوق حافة الرأس */}
      <div className="absolute end-5 top-[5.75rem] rounded-full bg-white p-1.5 shadow-lg ring-1 ring-gray-100 transition-transform duration-300 group-hover:scale-105">
        <OccupancyRing pct={o?.unitsPct ?? null} size={76} stroke={7} label="إشغال" />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5 pt-4">
        <div className="flex items-center gap-2.5 pe-24">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent-500 to-[#2a78d6] text-sm font-bold text-white shadow-md shadow-accent-500/25">
            {b.managerName ? b.managerName.trim().charAt(0) : "؟"}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] text-gray-400">مدير الفرع</p>
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-900">
              {b.managerName ?? <span className="font-normal text-gray-400">لم يُحدد بعد</span>}
              {b.managerActing && <Badge color="blue">مؤقت</Badge>}
            </p>
          </div>
        </div>

        {preparing && (!o || o.units === 0) ? (
          <p className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200/70">
            الفرع قيد التجهيز — تُضاف المكاتب والوحدات عند جاهزيته.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { k: "الوحدات", v: o?.units ?? 0, c: "text-brand-900" },
              { k: "مؤجرة", v: o?.occupiedUnits ?? 0, c: "text-emerald-700" },
              { k: "متاحة", v: available, c: available > 0 ? "text-accent-700" : "text-gray-500" },
            ].map((s) => (
              <div key={s.k} className="rounded-xl bg-gray-50 py-2.5 ring-1 ring-gray-100 transition-colors group-hover:bg-accent-50/40">
                <p className={cx("tabular text-xl font-bold", s.c)}>{s.v}</p>
                <p className="text-[11px] text-gray-500">{s.k}</p>
              </div>
            ))}
          </div>
        )}

        {o && o.seats > 0 && (
          <div>
            <OccupancyBar pct={o.seatsPct} label={`المقاعد ${o.occupiedSeats} من ${o.seats}`} />
          </div>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-3 text-xs">
          <span className="flex items-center gap-3 text-gray-500">
            {b.phone && <span dir="ltr" className="tabular flex items-center gap-1"><Icon name="phone" className="size-3.5" />{b.phone}</span>}
          </span>
          <span className="flex items-center gap-1 font-semibold text-brand-700 transition-all group-hover:gap-2 group-hover:text-accent-700">
            التفاصيل
            <Icon name="arrowLeft" className="size-4 transition-transform duration-300 group-hover:-translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default async function BranchesPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const actor = await requirePageActor("branches.view");
  const { view, q } = await searchParams;
  const { branches: all, total } = await listBranches(prisma, actor);
  const canCreate = actor.permissions.has("branches.manage") && actor.allBranches;
  const asTable = view === "table";
  const term = q?.trim();
  const branches = term
    ? all.filter((b) => [b.nameAr, b.city, b.code, b.managerName].some((x) => x?.toLowerCase().includes(term.toLowerCase())))
    : all;
  const groups = [
    { key: "ACTIVE", title: "الفروع العاملة", items: branches.filter((b) => b.status === "ACTIVE") },
    { key: "PREPARING", title: "قيد التجهيز", items: branches.filter((b) => b.status === "PREPARING") },
    { key: "INACTIVE", title: "موقوفة", items: branches.filter((b) => b.status === "INACTIVE") },
  ].filter((g) => g.items.length > 0);
  const activeCount = all.filter((b) => b.status === "ACTIVE").length;
  const preparingCount = all.filter((b) => b.status === "PREPARING").length;
  const qs = (v?: string) => {
    const p = new URLSearchParams();
    if (v) p.set("view", v);
    if (term) p.set("q", term);
    const s = p.toString();
    return `/branches${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title="الفروع"
        description="الفروع المصرح لك بها مع نسب الإشغال اليوم."
        actions={
          <>
            {actor.permissions.has("branches.manage") && <LinkButton href="/units/types" variant="secondary">أنواع الوحدات</LinkButton>}
            {canCreate && <LinkButton href="/branches/new" icon="plus">فرع جديد</LinkButton>}
          </>
        }
      />

      {all.length > 0 && (
        <>
          <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="الفروع العاملة" value={String(activeCount)} hint={preparingCount ? `+ ${preparingCount} قيد التجهيز` : undefined} icon="branches" />
            <StatCard label="إجمالي الوحدات" value={String(total.units)} hint={`${total.seats} مقعد`} icon="units" />
            <StatCard label="الوحدات المؤجرة" value={String(total.occupiedUnits)} hint={`${total.units - total.occupiedUnits} متاحة`} icon="units" tone="good" />
            <StatCard label="المقاعد المؤجرة" value={String(total.occupiedSeats)} hint={total.seatsPct === null ? "لا توجد مقاعد" : `إشغال المقاعد ${total.seatsPct}%`} icon="tenants" />
          </div>

          <Card className="mb-6">
            <div className="flex flex-col items-center gap-6 p-5 sm:flex-row">
              <OccupancyRing pct={total.unitsPct} size={120} stroke={10} label="الإشغال الكلي" />
              <div className="w-full flex-1">
                <p className="mb-3 text-sm font-semibold text-gray-900">الإشغال الإجمالي للفروع المعروضة</p>
                <OccupancyBreakdown o={total} />
              </div>
            </div>
          </Card>

          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <form className="flex w-full max-w-sm gap-2 sm:w-auto" role="search">
              {asTable && <input type="hidden" name="view" value="table" />}
              <label htmlFor="q" className="sr-only">بحث عن فرع</label>
              <div className="relative flex-1">
                <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <input id="q" name="q" defaultValue={term} placeholder="ابحث بالاسم أو المدينة أو المدير…" className={inputClass + " ps-9"} />
              </div>
              <button className={buttonClass("secondary")}>بحث</button>
            </form>
            <div className="inline-flex rounded-xl bg-gray-100 p-1 text-sm" role="tablist" aria-label="طريقة العرض">
              <Link href={qs()} role="tab" aria-selected={!asTable} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", !asTable ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>بطاقات</Link>
              <Link href={qs("table")} role="tab" aria-selected={asTable} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", asTable ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>جدول</Link>
            </div>
          </div>
        </>
      )}

      {branches.length === 0 ? (
        <Card>
          <EmptyState
            icon="branches"
            title={term ? "لا توجد فروع مطابقة للبحث" : "لا توجد فروع متاحة لك"}
            description={term ? undefined : "تواصل مع مسؤول النظام لمنحك صلاحية على الفروع."}
            action={term ? <LinkButton href={qs(asTable ? "table" : undefined).replace(/[?&]q=[^&]*/, "")} variant="secondary">مسح البحث</LinkButton> : undefined}
          />
        </Card>
      ) : asTable ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>الفرع</Th>
                <Th>المدير</Th>
                <Th>الوحدات</Th>
                <Th>الإشغال (وحدات)</Th>
                <Th>الإشغال (مقاعد)</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/branches/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.nameAr}</Link>
                    <span className="block text-xs text-gray-400">{b.city ?? "مدينة غير محددة"} · <span dir="ltr" className="font-mono">{b.code}</span></span>
                  </Td>
                  <Td>
                    {b.managerName ? (
                      <>
                        {b.managerName}
                        {b.managerActing && <span className="ms-1.5"><Badge color="blue">مؤقت</Badge></span>}
                      </>
                    ) : (
                      <span className="text-gray-400">لم يُحدد بعد</span>
                    )}
                  </Td>
                  <Td className="tabular">
                    {b.occupancy?.units ?? 0}
                    <span className="block text-xs text-gray-400">{b.occupancy?.occupiedUnits ?? 0} مؤجرة</span>
                  </Td>
                  <Td><OccupancyBar pct={b.occupancy?.unitsPct ?? null} /></Td>
                  <Td><OccupancyBar pct={b.occupancy?.seatsPct ?? null} /></Td>
                  <Td><Badge color={STATUS_COLOR[b.status]}>{BRANCH_STATUS_LABELS[b.status]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="mb-4 flex items-center gap-2.5 text-lg font-bold text-brand-900">
                <span className={cx("h-5 w-1.5 rounded-full", g.key === "ACTIVE" ? "bg-gradient-to-b from-accent-500 to-brand-700" : g.key === "PREPARING" ? "bg-amber-400" : "bg-gray-400")} aria-hidden="true" />
                {g.title}
                <span className="tabular rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">{g.items.length}</span>
              </h2>
              <div className="stagger grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {g.items.map((b) => <BranchCard key={b.id} b={b} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
