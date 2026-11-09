import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate } from "@/lib/dates";
import { TENANT_STATUS_COLOR, TENANT_STATUS_LABELS, listTenants } from "@/services/tenants.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "المستأجرون" };
type SP = Record<string, string | undefined>;

export default async function TenantsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("tenants.view");
  const sp = await searchParams;
  const [{ tenants, total, page, pages, filters }, branches] = await Promise.all([
    listTenants(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/tenants?${p}`;
  };
  return (
    <>
      <PageHeader
        title="المستأجرون"
        description={`${total} عميل`}
        actions={actor.permissions.has("tenants.manage") ? <LinkButton href="/tenants/new" icon="plus">عميل جديد</LinkButton> : undefined}
      />
      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5" role="search">
          <div className="lg:col-span-2">
            <label htmlFor="q" className="sr-only">بحث</label>
            <input id="q" name="q" defaultValue={filters.q} placeholder="الاسم، الجوال، البريد، السجل التجاري، رقم العقد…" className={inputClass} />
          </div>
          <select name="branchId" defaultValue={filters.branchId ?? ""} aria-label="الفرع" className={inputClass}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
          <select name="status" defaultValue={filters.status ?? ""} aria-label="الحالة" className={inputClass}>
            <option value="">كل الحالات</option>
            <option value="PROSPECT">محتمل</option>
            <option value="ACTIVE">نشط</option>
            <option value="FORMER">سابق</option>
          </select>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={!!filters.archived} className="size-4 accent-brand-700" /> المؤرشفون</label>
            <button className={buttonClass("primary", "flex-1")}>بحث</button>
          </div>
        </form>
      </Card>
      <Card>
        {tenants.length === 0 ? (
          <EmptyState icon="tenants" title={filters.q || filters.status ? "لا توجد نتائج" : "لا يوجد عملاء بعد"} description="أضف ملف العميل ثم أنشئ له عقدًا." />
        ) : (
          <Table>
            <thead><tr><Th>العميل</Th><Th>الفرع</Th><Th>الجوال</Th><Th>عقود نشطة</Th><Th>الحالة</Th><Th>آخر تحديث</Th></tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-gray-50">
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
