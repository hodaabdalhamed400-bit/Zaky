import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate } from "@/lib/dates";
import { TENANT_STATUS_COLOR, TENANT_STATUS_LABELS, listTenants, tenantStats } from "@/services/tenants.service";
import { toWhatsAppNumber } from "@/services/reminders.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "المستأجرون" };
type SP = Record<string, string | undefined>;
type Tenant = Awaited<ReturnType<typeof listTenants>>["tenants"][number];

const AVATAR: Record<string, string> = {
  ACTIVE: "from-accent-500 to-[#2a78d6] shadow-accent-500/30",
  PROSPECT: "from-[#5b8def] to-[#3a5fc8] shadow-blue-500/25",
  FORMER: "from-gray-400 to-gray-600 shadow-gray-400/25",
};
const DOT: Record<string, string> = { ACTIVE: "bg-emerald-500", PROSPECT: "bg-sky-500", FORMER: "bg-gray-400" };

function TenantCard({ t }: { t: Tenant }) {
  const wa = toWhatsAppNumber(t.mobile);
  return (
    <li
      data-tenant-card
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-accent-500/40 hover:shadow-[0_18px_36px_-16px_rgb(19_46_75/0.3)]"
    >
      <div className="pointer-events-none absolute -top-14 -end-14 size-36 rounded-full bg-accent-500/10 blur-2xl transition-transform duration-700 group-hover:scale-150" aria-hidden="true" />
      <div className="relative flex items-start gap-3">
        <span className={cx("grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-lg font-bold text-white shadow-lg transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110", AVATAR[t.status])}>
          {t.type === "COMPANY" ? <Icon name="branches" className="size-5" /> : t.name.trim().charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          {/* رابط ممتد يغطي البطاقة كاملة، وروابط الاتصال فوقه */}
          <Link href={`/tenants/${t.id}`} className="block truncate text-base font-bold text-brand-900 after:absolute after:inset-0 after:content-[''] hover:text-accent-700">
            {t.name}
          </Link>
          <p className="truncate text-xs text-gray-500">{t.type === "COMPANY" ? "منشأة" : "فرد"}{t.contactPersonName ? ` · ${t.contactPersonName}` : ""}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-semibold text-gray-700 ring-1 ring-gray-200">
          <span className={cx("size-2 rounded-full", DOT[t.status])} />
          {TENANT_STATUS_LABELS[t.status]}
        </span>
      </div>

      <dl className="relative mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl bg-gray-50 p-2.5 ring-1 ring-gray-100 transition-colors group-hover:bg-accent-50/40">
          <dt className="text-gray-500">الفرع</dt>
          <dd className="mt-0.5 truncate font-semibold text-gray-800">{t.primaryBranch?.nameAr ?? "—"}</dd>
        </div>
        <div className="rounded-xl bg-gray-50 p-2.5 ring-1 ring-gray-100 transition-colors group-hover:bg-accent-50/40">
          <dt className="text-gray-500">عقود نشطة</dt>
          <dd className={cx("tabular mt-0.5 font-bold", t._count.contracts > 0 ? "text-emerald-700" : "text-gray-500")}>{t._count.contracts}</dd>
        </div>
      </dl>

      <div className="relative mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs">
        <span className="tabular text-gray-400">آخر تحديث {formatDate(t.updatedAt)}</span>
        {t.mobile && (
          <span className="relative z-10 flex items-center gap-1.5">
            <a href={`tel:${t.mobile}`} className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand-700 transition-colors hover:bg-brand-700 hover:text-white" aria-label={`اتصال بـ ${t.name}`} title={t.mobile}>
              <Icon name="phone" className="size-4" />
            </a>
            {wa && (
              <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer" className="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white" aria-label={`واتساب ${t.name}`}>
                <Icon name="message" className="size-4" />
              </a>
            )}
          </span>
        )}
      </div>
    </li>
  );
}

export default async function TenantsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("tenants.view");
  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "cards";
  const [{ tenants, total, page, pages, filters }, branches] = await Promise.all([
    listTenants(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const stats = await tenantStats(prisma, actor, filters.branchId);
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/tenants?${s}` : "/tenants";
  };
  const chips: { key?: string; label: string; n: number; dot: string }[] = [
    { label: "الكل", n: stats.all, dot: "bg-brand-700" },
    { key: "ACTIVE", label: "نشط", n: stats.active, dot: "bg-emerald-500" },
    { key: "PROSPECT", label: "محتمل", n: stats.prospect, dot: "bg-sky-500" },
    { key: "FORMER", label: "سابق", n: stats.former, dot: "bg-gray-400" },
  ];

  return (
    <>
      <PageHeader
        title="المستأجرون"
        description={`${total} عميل`}
        actions={actor.permissions.has("tenants.manage") ? <LinkButton href="/tenants/new" icon="plus">عميل جديد</LinkButton> : undefined}
      />

      {stats.all > 0 && (
        <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="إجمالي العملاء" value={String(stats.all)} hint={`${stats.companies} منشأة · ${stats.individuals} فرد`} icon="tenants" />
          <StatCard label="عملاء نشطون" value={String(stats.active)} hint="لديهم عقود حالية" icon="check" tone="good" />
          <StatCard label="عملاء محتملون" value={String(stats.prospect)} hint="لم يتعاقدوا بعد" icon="users" />
          <StatCard label="عملاء سابقون" value={String(stats.former)} hint="انتهت عقودهم" icon="audit" />
        </div>
      )}

      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-[1fr_14rem_auto]" role="search">
          <input type="hidden" name="view" value={view} />
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          <div className="relative">
            <label htmlFor="q" className="sr-only">بحث</label>
            <Icon name="search" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input id="q" name="q" defaultValue={filters.q} placeholder="الاسم، الجوال، البريد، السجل التجاري، رقم العقد…" className={inputClass + " ps-9"} />
          </div>
          <select name="branchId" defaultValue={filters.branchId ?? ""} aria-label="الفرع" className={inputClass}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={!!filters.archived} className="size-4 accent-brand-700" /> المؤرشفون</label>
            <button className={buttonClass("primary", "flex-1")}>بحث</button>
          </div>
        </form>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3">
          <nav className="flex flex-wrap gap-1.5" aria-label="تصفية حسب الحالة">
            {chips.map((c) => {
              const active = (filters.status ?? undefined) === c.key && !filters.archived;
              return (
                <Link
                  key={c.label}
                  href={qs({ status: c.key, page: undefined, archived: undefined })}
                  aria-current={active ? "true" : undefined}
                  className={cx(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition-all duration-200",
                    active ? "bg-brand-900 text-white shadow-md ring-brand-900" : "bg-white text-gray-700 ring-gray-200 hover:text-brand-900 hover:ring-accent-500/50",
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
            <Link href={qs({ view: "cards" })} aria-current={view === "cards" ? "true" : undefined} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", view === "cards" ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>بطاقات</Link>
            <Link href={qs({ view: "table" })} aria-current={view === "table" ? "true" : undefined} className={cx("rounded-lg px-4 py-1.5 font-medium transition-all", view === "table" ? "bg-white text-brand-900 shadow-sm" : "text-gray-500 hover:text-gray-800")}>جدول</Link>
          </div>
        </div>
      </Card>

      {tenants.length === 0 ? (
        <Card>
          <EmptyState
            icon="tenants"
            title={filters.q || filters.status ? "لا توجد نتائج" : "لا يوجد عملاء بعد"}
            description="أضف ملف العميل ثم أنشئ له عقدًا."
            action={actor.permissions.has("tenants.manage") && !filters.q && !filters.status ? <LinkButton href="/tenants/new" icon="plus">إضافة أول عميل</LinkButton> : undefined}
          />
        </Card>
      ) : view === "table" ? (
        <Card>
          <Table>
            <thead><tr><Th>العميل</Th><Th>الفرع</Th><Th>الجوال</Th><Th>عقود نشطة</Th><Th>الحالة</Th><Th>آخر تحديث</Th></tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/tenants/${t.id}`} className="font-medium text-brand-700 hover:underline">{t.name}</Link>
                    <span className="block text-xs text-gray-400">{t.type === "COMPANY" ? "منشأة" : "فرد"}{t.contactPersonName ? ` · ${t.contactPersonName}` : ""}</span>
                  </Td>
                  <Td>{t.primaryBranch?.nameAr ?? "—"}</Td>
                  <Td><span dir="ltr" className="tabular">{t.mobile ?? "—"}</span></Td>
                  <Td className="tabular">{t._count.contracts}</Td>
                  <Td><Badge color={TENANT_STATUS_COLOR[t.status]}>{TENANT_STATUS_LABELS[t.status]}</Badge></Td>
                  <Td className="tabular text-xs text-gray-500">{formatDate(t.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <ul className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tenants.map((t) => <TenantCard key={t.id} t={t} />)}
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
