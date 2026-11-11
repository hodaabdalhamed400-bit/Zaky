import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { formatSAR } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { PRICING_CYCLE_LABELS, effectiveUnitStatus, listUnits, unitFormOptions, unitStats } from "@/services/units.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { Icon, type IconName } from "@/components/ui/icons";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "المكاتب والوحدات" };

type SP = Record<string, string | undefined>;
type Unit = Awaited<ReturnType<typeof listUnits>>["units"][number];

function qs(sp: SP, patch: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/units?${s}` : "/units";
}

const TYPE_ICON: Record<string, IconName> = { PRIVATE_OFFICE: "units", SHARED_OFFICE: "tenants", MEETING_ROOM: "calendar", ADMIN_SPACE: "branches" };

/** ألوان الحالة: شريط علوي + نقطة + خلفية الأيقونة */
const TONE: Record<string, { bar: string; dot: string; chip: string }> = {
  OCCUPIED: { bar: "from-brand-700 to-brand-900", dot: "bg-brand-700", chip: "from-brand-700 to-brand-900" },
  PARTIAL: { bar: "from-[#2a78d6] to-brand-700", dot: "bg-[#2a78d6]", chip: "from-[#2a78d6] to-brand-700" },
  AVAILABLE: { bar: "from-emerald-400 to-emerald-600", dot: "bg-emerald-500", chip: "from-emerald-500 to-emerald-700" },
  RESERVED: { bar: "from-amber-300 to-amber-500", dot: "bg-amber-500", chip: "from-amber-400 to-amber-600" },
  RENTED: { bar: "from-brand-700 to-brand-900", dot: "bg-brand-700", chip: "from-brand-700 to-brand-900" },
  MAINTENANCE: { bar: "from-rose-400 to-red-600", dot: "bg-red-500", chip: "from-rose-500 to-red-700" },
  INACTIVE: { bar: "from-gray-300 to-gray-500", dot: "bg-gray-400", chip: "from-gray-400 to-gray-600" },
  ARCHIVED: { bar: "from-gray-300 to-gray-500", dot: "bg-gray-400", chip: "from-gray-400 to-gray-600" },
};

function UnitCard({ u }: { u: Unit }) {
  const st = effectiveUnitStatus(u, u.occupiedSeats);
  const tone = TONE[st.key] ?? TONE.INACTIVE!;
  const shared = u.occupancyMode === "SHARED";
  const seatPct = shared && u.capacity > 0 ? Math.round((u.occupiedSeats / u.capacity) * 100) : null;
  return (
    <li>
      <Link
        href={`/units/${u.id}`}
        data-unit-card
        className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-accent-500/40 hover:shadow-[0_18px_36px_-16px_rgb(19_46_75/0.3)]"
      >
        <div className={cx("h-1.5 bg-gradient-to-l", tone.bar)} aria-hidden="true" />
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex items-start gap-3">
            <span className={cx("grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110", tone.chip)}>
              <Icon name={TYPE_ICON[u.unitType.key] ?? "units"} className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xl font-bold tracking-tight text-brand-900">{u.code}</p>
              <p className="truncate text-xs text-gray-500">{u.branch.nameAr}{u.floor ? ` · ${u.floor.name}` : ""}</p>
            </div>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200">
              <span className="relative flex size-2">
                {st.key === "AVAILABLE" && <span className={cx("absolute inline-flex size-full animate-ping-soft rounded-full", tone.dot)} />}
                <span className={cx("relative inline-flex size-2 rounded-full", tone.dot)} />
              </span>
              {st.label}
            </span>
          </div>

          <dl className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-xl bg-gray-50 p-2 ring-1 ring-gray-100 transition-colors group-hover:bg-accent-50/40"><dt className="text-gray-500">النوع</dt><dd className="mt-0.5 truncate font-semibold text-gray-800">{u.unitType.nameAr}</dd></div>
            <div className="rounded-xl bg-gray-50 p-2 ring-1 ring-gray-100 transition-colors group-hover:bg-accent-50/40"><dt className="text-gray-500">المساحة</dt><dd className="tabular mt-0.5 font-semibold text-gray-800">{u.areaSqm ? `${u.areaSqm.toFixed(0)} م²` : "—"}</dd></div>
            <div className="rounded-xl bg-gray-50 p-2 ring-1 ring-gray-100 transition-colors group-hover:bg-accent-50/40"><dt className="text-gray-500">السعة</dt><dd className="tabular mt-0.5 font-semibold text-gray-800">{u.capacity}</dd></div>
          </dl>

          {seatPct !== null && (
            <div>
              <div className="flex justify-between text-xs"><span className="text-gray-500">المقاعد المؤجرة</span><span className="tabular font-semibold text-gray-800">{u.occupiedSeats} / {u.capacity}</span></div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={seatPct} aria-valuemin={0} aria-valuemax={100} aria-label="نسبة المقاعد المؤجرة">
                <div className="h-full origin-right animate-grow-x rounded-full bg-gradient-to-l from-accent-500 to-[#2a78d6]" style={{ width: `${seatPct}%` }} />
              </div>
            </div>
          )}

          {u.current ? (
            <div className="flex items-center gap-2 rounded-xl bg-brand-50/60 px-3 py-2 text-xs ring-1 ring-brand-100">
              <Icon name="tenants" className="size-4 shrink-0 text-brand-700" />
              <span className="min-w-0 flex-1 truncate font-medium text-brand-900">{u.current.names.join("، ")}</span>
              <span className="tabular whitespace-nowrap text-gray-500">حتى {formatDate(u.current.until)}</span>
            </div>
          ) : null}

          <div className="mt-auto flex items-end justify-between border-t border-gray-100 pt-3">
            <p className="tabular text-lg font-bold text-brand-900">
              {formatSAR(u.basePrice)}
              <span className="ms-1 text-xs font-normal text-gray-400">/ {PRICING_CYCLE_LABELS[u.pricingCycle]}</span>
            </p>
            <Icon name="arrowLeft" className="size-4 text-brand-700 transition-transform duration-300 group-hover:-translate-x-1 group-hover:text-accent-700" />
          </div>
        </div>
      </Link>
    </li>
  );
}

export default async function UnitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("units.view");
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "cards";
  const [res, opts] = await Promise.all([listUnits(prisma, actor, sp), unitFormOptions(prisma, actor)]);
  const { units, total, page, pages, filters } = res;
  const stats = await unitStats(prisma, actor, filters.branchId);
  const canManage = actor.permissions.has("units.manage");
  const hasFilters = Object.entries(filters).some(([k, v]) => v && k !== "page");
  const advanced = !!(filters.unitTypeId || filters.minArea || filters.maxArea || filters.minPrice || filters.maxPrice || filters.archived);
  const chips: { key?: string; label: string; n: number; dot: string }[] = [
    { label: "الكل", n: stats.all, dot: "bg-brand-700" },
    { key: "FREE", label: "متاحة", n: stats.free, dot: "bg-emerald-500" },
    { key: "OCCUPIED", label: "مؤجرة", n: stats.occupied, dot: "bg-brand-700" },
    { key: "RESERVED", label: "محجوزة", n: stats.reserved, dot: "bg-amber-500" },
    { key: "MAINTENANCE", label: "صيانة", n: stats.maintenance, dot: "bg-red-500" },
    { key: "INACTIVE", label: "غير نشطة", n: stats.inactive, dot: "bg-gray-400" },
  ];

  return (
    <>
      <PageHeader
        title="المكاتب والوحدات"
        description={`${total} وحدة${filters.archived ? " مؤرشفة" : ""} مطابقة`}
        actions={canManage ? <LinkButton href={filters.branchId ? `/units/new?branchId=${filters.branchId}` : "/units/new"} icon="plus">وحدة جديدة</LinkButton> : undefined}
      />

      {stats.all > 0 && (
        <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="إجمالي الوحدات" value={String(stats.all)} hint={filters.branchId ? "في الفرع المختار" : "في الفروع المتاحة لك"} icon="units" />
          <StatCard label="مؤجرة الآن" value={String(stats.occupied)} hint={stats.all ? `${Math.round((stats.occupied / stats.all) * 100)}% من الوحدات` : undefined} icon="contracts" tone="good" />
          <StatCard label="متاحة للتأجير" value={String(stats.free)} hint="بلا عقد ساري" icon="check" />
          <StatCard label="صيانة / محجوزة" value={String(stats.maintenance + stats.reserved)} hint={`${stats.maintenance} صيانة · ${stats.reserved} محجوزة`} icon="alert" tone="warn" />
        </div>
      )}

      <Card className="mb-4">
        <form className="space-y-3 p-4" role="search" aria-label="تصفية الوحدات">
          <input type="hidden" name="view" value={view} />
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem_auto]">
            <div className="relative">
              <label htmlFor="q" className="sr-only">بحث</label>
              <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
              <input id="q" name="q" defaultValue={filters.q} placeholder="بحث برقم الوحدة أو الوصف…" className={inputClass + " ps-9"} />
            </div>
            <div>
              <label htmlFor="f-branch" className="sr-only">الفرع</label>
              <select id="f-branch" name="branchId" defaultValue={filters.branchId ?? ""} className={inputClass}>
                <option value="">كل الفروع</option>
                {opts.branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button className={buttonClass("primary", "flex-1")}>تطبيق</button>
              {hasFilters && <Link href={`/units?view=${view}`} className={buttonClass("ghost")}>مسح</Link>}
            </div>
          </div>
          <details open={advanced} className="group/adv">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-accent-700">
              <Icon name="plus" className="size-4 transition-transform duration-300 group-open/adv:rotate-45" />
              تصفية متقدمة
            </summary>
            <div className="mt-3 grid animate-fade-in gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="f-type" className="sr-only">النوع</label>
                <select id="f-type" name="unitTypeId" defaultValue={filters.unitTypeId ?? ""} className={inputClass}>
                  <option value="">كل الأنواع</option>
                  {opts.types.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <input name="minArea" defaultValue={filters.minArea} inputMode="decimal" placeholder="مساحة من" aria-label="المساحة من" className={inputClass} />
                <input name="maxArea" defaultValue={filters.maxArea} inputMode="decimal" placeholder="إلى (م²)" aria-label="المساحة إلى" className={inputClass} />
              </div>
              <div className="flex gap-2">
                <input name="minPrice" defaultValue={filters.minPrice} inputMode="decimal" placeholder="سعر من" aria-label="السعر من" className={inputClass} />
                <input name="maxPrice" defaultValue={filters.maxPrice} inputMode="decimal" placeholder="إلى (ر.س)" aria-label="السعر إلى" className={inputClass} />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" name="archived" value="1" defaultChecked={!!filters.archived} className="size-4 accent-brand-700" />
                عرض المؤرشفة
              </label>
            </div>
          </details>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <nav className="flex flex-wrap gap-1.5" aria-label="تصفية حسب الحالة">
            {chips.map((c) => {
              const active = (filters.status ?? undefined) === c.key && !filters.archived;
              return (
                <Link
                  key={c.label}
                  href={qs(sp, { status: c.key, page: undefined, archived: undefined })}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-all duration-200",
                    active ? "bg-brand-900 text-white ring-brand-900 shadow-md" : "bg-white text-gray-700 ring-gray-200 hover:ring-accent-500/50 hover:text-brand-900",
                  )}
                >
                  <span className={cx("size-1.5 rounded-full", active ? "bg-white" : c.dot)} />
                  {c.label}
                  <span className={cx("tabular rounded-full px-1.5 text-[10px]", active ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{c.n}</span>
                </Link>
              );
            })}
          </nav>
          <div className="inline-flex rounded-xl bg-gray-100 p-1 text-sm" aria-label="طريقة العرض">
            <Link href={qs(sp, { view: "cards" })} aria-current={view === "cards" ? "true" : undefined} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", view === "cards" ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>بطاقات</Link>
            <Link href={qs(sp, { view: "table" })} aria-current={view === "table" ? "true" : undefined} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", view === "table" ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>جدول</Link>
          </div>
        </div>
      </Card>

      {units.length === 0 ? (
        <Card>
          <EmptyState
            icon="units"
            title={hasFilters ? "لا توجد وحدات مطابقة" : "لا توجد وحدات بعد"}
            description={hasFilters ? "جرّب تعديل معايير البحث." : "أضف مكاتب ووحدات كل فرع لتبدأ متابعة الإشغال."}
            action={canManage && !hasFilters ? <LinkButton href="/units/new" icon="plus">إضافة أول وحدة</LinkButton> : undefined}
          />
        </Card>
      ) : view === "table" ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>الوحدة</Th>
                <Th>الفرع</Th>
                <Th>النوع</Th>
                <Th>المساحة</Th>
                <Th>السعة</Th>
                <Th>السعر</Th>
                <Th>المستأجر الحالي</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const st = effectiveUnitStatus(u, u.occupiedSeats);
                return (
                  <tr key={u.id}>
                    <Td>
                      <Link href={`/units/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.code}</Link>
                      {u.floor && <span className="block text-xs text-gray-400">{u.floor.name}</span>}
                    </Td>
                    <Td>{u.branch.nameAr}</Td>
                    <Td>{u.unitType.nameAr}</Td>
                    <Td className="tabular">{u.areaSqm ? `${u.areaSqm.toFixed(2)} م²` : <span className="text-gray-400">—</span>}</Td>
                    <Td className="tabular">{u.capacity}</Td>
                    <Td className="tabular whitespace-nowrap">{formatSAR(u.basePrice)}<span className="text-xs text-gray-400"> / {PRICING_CYCLE_LABELS[u.pricingCycle]}</span></Td>
                    <Td className="text-xs">{u.current ? u.current.names.join("، ") : <span className="text-gray-400">—</span>}</Td>
                    <Td><Badge color={st.color}>{st.label}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {units.map((u) => <UnitCard key={u.id} u={u} />)}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2 text-sm" aria-label="الصفحات">
          {page > 1 && <Link href={qs(sp, { page: String(page - 1) })} className={buttonClass("secondary")}>السابق</Link>}
          <span className="tabular px-2 text-gray-500">صفحة {page} من {pages}</span>
          {page < pages && <Link href={qs(sp, { page: String(page + 1) })} className={buttonClass("secondary")}>التالي</Link>}
        </nav>
      )}
    </>
  );
}
