import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABELS, listContracts } from "@/services/contracts.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "العقود" };
type SP = Record<string, string | undefined>;

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("contracts.view");
  const sp = await searchParams;
  const [{ contracts, total, page, pages, filters }, branches] = await Promise.all([
    listContracts(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/contracts?${p}`;
  };
  const quick = [
    { label: "بانتظار الاعتماد", href: "/contracts?status=PENDING_APPROVAL" },
    { label: "تنتهي خلال 30 يومًا", href: "/contracts?expiring=30" },
    { label: "النشطة", href: "/contracts?status=ACTIVE" },
    { label: "المسودات", href: "/contracts?status=DRAFT" },
  ];
  return (
    <>
      <PageHeader
        title="العقود"
        description={`${total} عقد`}
        actions={actor.permissions.has("contracts.create") ? <LinkButton href="/contracts/new" icon="plus">عقد جديد</LinkButton> : undefined}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {quick.map((q) => <Link key={q.href} href={q.href} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 hover:border-accent-300">{q.label}</Link>)}
      </div>
      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" role="search">
          <div className="lg:col-span-2">
            <label htmlFor="q" className="sr-only">بحث</label>
            <input id="q" name="q" defaultValue={filters.q} placeholder="رقم العقد، اسم المستأجر، رقم الوحدة…" className={inputClass} />
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
      </Card>
      <Card>
        {contracts.length === 0 ? (
          <EmptyState icon="contracts" title="لا توجد عقود مطابقة" />
        ) : (
          <Table>
            <thead><tr><Th>رقم العقد</Th><Th>المستأجر</Th><Th>الفرع / الوحدات</Th><Th>من</Th><Th>إلى</Th><Th>الإجمالي</Th><Th>الحالة</Th></tr></thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
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
        )}
      </Card>
      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm" aria-label="الصفحات">
          {page > 1 && <Link href={qs({ page: String(page - 1) })} className={buttonClass("secondary")}>السابق</Link>}
          <span className="tabular px-2 text-gray-500">صفحة {page} من {pages}</span>
          {page < pages && <Link href={qs({ page: String(page + 1) })} className={buttonClass("secondary")}>التالي</Link>}
        </nav>
      )}
    </>
  );
}
