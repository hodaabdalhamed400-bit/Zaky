import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABELS, contractStats, listContracts } from "@/services/contracts.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "العقود" };
type SP = Record<string, string | undefined>;
type Contract = Awaited<ReturnType<typeof listContracts>>["contracts"][number];

const DAY = 86_400_000;
const BAR: Record<string, string> = {
  ACTIVE: "from-emerald-400 to-emerald-600",
  PENDING_APPROVAL: "from-amber-300 to-amber-500",
  DRAFT: "from-gray-300 to-gray-400",
  EXPIRED: "from-gray-300 to-gray-500",
  RENEWED: "from-[#5b8def] to-[#2a78d6]",
  TERMINATED: "from-rose-400 to-red-600",
  CANCELLED: "from-rose-300 to-rose-500",
};

function ContractCard({ c, today }: { c: Contract; today: number }) {
  const start = c.startDate.getTime();
  const end = c.endDate.getTime();
  const elapsed = Math.min(100, Math.max(0, Math.round(((today - start) / Math.max(DAY, end - start + DAY)) * 100)));
  const daysLeft = Math.round((end - today) / DAY);
  const live = c.status === "ACTIVE";
  const soon = live && daysLeft >= 0 && daysLeft <= 30;
  return (
    <li
      data-contract-card
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-accent-500/40 hover:shadow-[0_18px_36px_-16px_rgb(19_46_75/0.3)]"
    >
      <div className={cx("h-1.5 bg-gradient-to-l", BAR[c.status])} aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={`/contracts/${c.id}`} dir="ltr" className="block font-mono text-sm font-bold text-brand-900 after:absolute after:inset-0 after:content-[''] hover:text-accent-700">
              {c.contractNo}
            </Link>
            <p className="mt-0.5 truncate text-base font-semibold text-gray-900">{c.tenant.name}</p>
          </div>
          <Badge color={CONTRACT_STATUS_COLOR[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="inline-flex items-center gap-1 rounded-lg bg-gray-50 px-2 py-1 text-gray-600 ring-1 ring-gray-100"><Icon name="branches" className="size-3.5" />{c.branch.nameAr}</span>
          {c.units.slice(0, 4).map((u) => (
            <span key={u.id} className="rounded-lg bg-brand-50 px-2 py-1 font-medium text-brand-700 ring-1 ring-brand-100">{u.unit.code}</span>
          ))}
          {c.units.length > 4 && <span className="text-gray-400">+{c.units.length - 4}</span>}
        </div>

        <div>
          <div className="flex justify-between text-xs text-gray-500">
            <span className="tabular">{formatDate(c.startDate)}</span>
            <span className="tabular">{formatDate(c.endDate)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={elapsed} aria-valuemin={0} aria-valuemax={100} aria-label="المدة المنقضية من العقد">
            <div className={cx("h-full origin-right animate-grow-x rounded-full bg-gradient-to-l", soon ? "from-amber-400 to-amber-600" : "from-accent-500 to-brand-700")} style={{ width: `${elapsed}%` }} />
          </div>
          <p className={cx("mt-1.5 text-xs font-medium", soon ? "text-amber-700" : "text-gray-500")}>
            {live ? (daysLeft < 0 ? "انتهت مدته" : daysLeft === 0 ? "ينتهي اليوم" : `متبقٍ ${daysLeft} يومًا`) : `${c.durationMonths} شهرًا`}
            {soon && " — قريب الانتهاء"}
          </p>
        </div>

        <div className="mt-auto flex items-end justify-between border-t border-gray-100 pt-3">
          <div>
            <p className="text-[11px] text-gray-400">إجمالي العقد</p>
            <p className="tabular text-lg font-bold text-brand-900">{formatSAR(c.totalAmount)}</p>
          </div>
          <Icon name="arrowLeft" className="size-4 text-brand-700 transition-transform duration-300 group-hover:-translate-x-1 group-hover:text-accent-700" />
        </div>
      </div>
    </li>
  );
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("contracts.view");
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "cards";
  const [{ contracts, total, page, pages, filters }, branches] = await Promise.all([
    listContracts(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const stats = await contractStats(prisma, actor, filters.branchId);
  const today = new Date(`${todayInRiyadh()}T00:00:00Z`).getTime();
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/contracts?${s}` : "/contracts";
  };
  const chips: { label: string; n: number; dot: string; patch: SP; active: boolean }[] = [
    { label: "الكل", n: stats.all, dot: "bg-brand-700", patch: { status: undefined, expiring: undefined }, active: !filters.status && !filters.expiring },
    { label: "نشطة", n: stats.active, dot: "bg-emerald-500", patch: { status: "ACTIVE", expiring: undefined }, active: filters.status === "ACTIVE" && !filters.expiring },
    { label: "تنتهي خلال 30 يومًا", n: stats.expiring, dot: "bg-amber-500", patch: { status: undefined, expiring: "30" }, active: filters.expiring === "30" },
    { label: "بانتظار الاعتماد", n: stats.pending, dot: "bg-amber-400", patch: { status: "PENDING_APPROVAL", expiring: undefined }, active: filters.status === "PENDING_APPROVAL" },
    { label: "مسودات", n: stats.draft, dot: "bg-gray-400", patch: { status: "DRAFT", expiring: undefined }, active: filters.status === "DRAFT" },
    { label: "منتهية", n: stats.expired, dot: "bg-gray-500", patch: { status: "EXPIRED", expiring: undefined }, active: filters.status === "EXPIRED" },
  ];

  return (
    <>
      <PageHeader
        title="العقود"
        description={`${total} عقد`}
        actions={actor.permissions.has("contracts.create") ? <LinkButton href="/contracts/new" icon="plus">عقد جديد</LinkButton> : undefined}
      />

      {stats.all > 0 && (
        <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="العقود النشطة" value={String(stats.active)} hint={`من ${stats.all} عقد`} icon="contracts" tone="good" />
          <StatCard label="الإيجار الشهري للعقود النشطة" value={formatSAR(stats.monthlyActive)} hint="شامل الضريبة" icon="finance" />
          <StatCard label="تنتهي خلال 30 يومًا" value={String(stats.expiring)} hint="تحتاج متابعة التجديد" icon="calendar" tone="warn" />
          <StatCard label="بانتظار الاعتماد" value={String(stats.pending)} hint={`${stats.draft} مسودة`} icon="alert" tone={stats.pending ? "bad" : "default"} />
        </div>
      )}

      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-[1fr_12rem_12rem_auto]" role="search">
          <input type="hidden" name="view" value={view} />
          <div className="relative">
            <label htmlFor="q" className="sr-only">بحث</label>
            <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input id="q" name="q" defaultValue={filters.q} placeholder="رقم العقد، اسم المستأجر، رقم الوحدة…" className={inputClass + " ps-9"} />
          </div>
          <select name="branchId" defaultValue={filters.branchId ?? ""} aria-label="الفرع" className={inputClass}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
          <select name="status" defaultValue={filters.status ?? ""} aria-label="الحالة" className={inputClass}>
            <option value="">كل الحالات</option>
            {Object.entries(CONTRACT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex gap-2">
            <select name="expiring" defaultValue={filters.expiring ?? ""} aria-label="ينتهي خلال" className={inputClass}>
              <option value="">أي تاريخ انتهاء</option>
              {["7", "15", "30", "60", "90"].map((d) => <option key={d} value={d}>ينتهي خلال {d} يومًا</option>)}
            </select>
            <button className={buttonClass("primary")}>بحث</button>
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <nav className="flex flex-wrap gap-1.5" aria-label="تصفية سريعة">
            {chips.map((c) => (
              <Link
                key={c.label}
                href={qs({ ...c.patch, page: undefined })}
                aria-current={c.active ? "true" : undefined}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-all duration-200",
                  c.active ? "bg-brand-900 text-white shadow-md ring-brand-900" : "bg-white text-gray-700 ring-gray-200 hover:text-brand-900 hover:ring-accent-500/50",
                )}
              >
                <span className={cx("size-1.5 rounded-full", c.active ? "bg-white" : c.dot)} />
                {c.label}
                <span className={cx("tabular rounded-full px-1.5 text-[10px]", c.active ? "bg-white/20" : "bg-gray-100 text-gray-600")}>{c.n}</span>
              </Link>
            ))}
          </nav>
          <div className="inline-flex rounded-xl bg-gray-100 p-1 text-sm" aria-label="طريقة العرض">
            <Link href={qs({ view: "cards" })} aria-current={view === "cards" ? "true" : undefined} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", view === "cards" ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>بطاقات</Link>
            <Link href={qs({ view: "table" })} aria-current={view === "table" ? "true" : undefined} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", view === "table" ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>جدول</Link>
          </div>
        </div>
      </Card>

      {contracts.length === 0 ? (
        <Card>
          <EmptyState
            icon="contracts"
            title={stats.all === 0 ? "لا توجد عقود بعد" : "لا توجد عقود مطابقة"}
            description={stats.all === 0 ? "أنشئ عقدًا لعميل مسجل وحدد الوحدات والمدة ودورة الدفع." : undefined}
            action={stats.all === 0 && actor.permissions.has("contracts.create") ? <LinkButton href="/contracts/new" icon="plus">إنشاء أول عقد</LinkButton> : undefined}
          />
        </Card>
      ) : view === "table" ? (
        <Card>
          <Table>
            <thead><tr><Th>رقم العقد</Th><Th>المستأجر</Th><Th>الفرع / الوحدات</Th><Th>من</Th><Th>إلى</Th><Th>الإجمالي</Th><Th>الحالة</Th></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <Td><Link href={`/contracts/${c.id}`} dir="ltr" className="font-mono text-xs font-medium text-brand-700 hover:underline">{c.contractNo}</Link></Td>
                  <Td><Link href={`/tenants/${c.tenant.id}`} className="hover:underline">{c.tenant.name}</Link></Td>
                  <Td>{c.branch.nameAr}<span className="block text-xs text-gray-400">{c.units.map((u) => u.unit.code).join("، ")}</span></Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(c.startDate)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(c.endDate)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatSAR(c.totalAmount)}</Td>
                  <Td><Badge color={CONTRACT_STATUS_COLOR[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {contracts.map((c) => <ContractCard key={c.id} c={c} today={today} />)}
        </ul>
      )}
      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2 text-sm" aria-label="الصفحات">
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className={buttonClass("secondary")}>السابق</Link>}
          <span className="tabular px-2 text-gray-500">صفحة {page} من {pages}</span>
          {page < pages && <Link href={qs({ page: String(page + 1) })} className={buttonClass("secondary")}>التالي</Link>}
        </nav>
      )}
    </>
  );
}
