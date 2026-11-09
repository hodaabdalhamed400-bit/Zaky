import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABELS, listPayments } from "@/services/payments.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "الدفعات" };
type SP = Record<string, string | undefined>;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("payments.view");
  const sp = await searchParams;
  const [{ payments, total, sumAmount, page, pages, filters }, branches] = await Promise.all([
    listPayments(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/finance/payments?${p}`;
  };
  return (
    <>
      <PageHeader
        title="الدفعات"
        description={`${total} دفعة · المجموع ${formatSAR(sumAmount)}`}
        actions={actor.permissions.has("payments.record") ? <LinkButton href="/finance/payments/new" icon="plus">تسجيل دفعة</LinkButton> : undefined}
      />
      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
          <div className="lg:col-span-2"><input name="q" defaultValue={filters.q} aria-label="بحث" placeholder="رقم الإيصال، المرجع، المستأجر، العقد…" className={inputClass} /></div>
          <select name="status" defaultValue={filters.status ?? ""} aria-label="الحالة" className={inputClass}>
            <option value="">كل الحالات</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="method" defaultValue={filters.method ?? ""} aria-label="الوسيلة" className={inputClass}>
            <option value="">كل الوسائل</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="branchId" defaultValue={filters.branchId ?? ""} aria-label="الفرع" className={inputClass}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
          <div className="flex gap-2 lg:col-span-6">
            <label className="flex items-center gap-2 text-sm text-gray-600">من <input type="date" name="from" defaultValue={filters.from} className={inputClass + " w-40"} /></label>
            <label className="flex items-center gap-2 text-sm text-gray-600">إلى <input type="date" name="to" defaultValue={filters.to} className={inputClass + " w-40"} /></label>
            <button className={buttonClass("primary")}>بحث</button>
          </div>
        </form>
      </Card>
      <Card>
        {payments.length === 0 ? (
          <EmptyState icon="finance" title="لا توجد دفعات مطابقة" />
        ) : (
          <Table>
            <thead><tr><Th>الإيصال</Th><Th>المستأجر / العقد</Th><Th>المبلغ</Th><Th>الوسيلة</Th><Th>تاريخ الدفع</Th><Th>الحالة</Th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <Td><Link href={`/finance/payments/${p.id}`} className="font-mono text-xs font-medium text-brand-700 hover:underline" dir="ltr">{p.receiptNo ?? "—"}</Link><span className="block text-xs text-gray-400">{p.branch.nameAr}</span></Td>
                  <Td>{p.tenant.name}<span dir="ltr" className="block font-mono text-xs text-gray-400">{p.contract?.contractNo}</span></Td>
                  <Td className="tabular whitespace-nowrap font-medium">{formatSAR(p.amount)}</Td>
                  <Td>{PAYMENT_METHOD_LABELS[p.method]}{p.referenceNo && <span dir="ltr" className="block text-xs text-gray-400">{p.referenceNo}</span>}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(p.paidOn)}</Td>
                  <Td><Link href={`/finance/payments/${p.id}`}><Badge color={PAYMENT_STATUS_COLOR[p.status]}>{PAYMENT_STATUS_LABELS[p.status]}</Badge></Link></Td>
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
