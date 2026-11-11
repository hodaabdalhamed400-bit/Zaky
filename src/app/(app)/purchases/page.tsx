import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import {
  PURCHASE_PAYMENT_COLOR,
  PURCHASE_PAYMENT_LABELS,
  PURCHASE_STATUS_COLOR,
  PURCHASE_STATUS_LABELS,
  listCategories,
  listPurchases,
} from "@/services/purchases.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "فواتير الشراء" };
type SP = Record<string, string | undefined>;

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("purchases.view");
  const sp = await searchParams;
  const [{ invoices, total, page, pages, filters, sums }, branches, categories] = await Promise.all([
    listPurchases(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
    listCategories(prisma, { includeInactive: true }),
  ]);
  const qs = (patch: SP) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/purchases?${p}`;
  };
  const can = (x: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(x);
  const reportQs = new URLSearchParams();
  if (filters.branchId) reportQs.set("branchId", filters.branchId);
  if (filters.from) reportQs.set("from", filters.from);
  if (filters.to) reportQs.set("to", filters.to);

  return (
    <>
      <PageHeader
        title="فواتير الشراء"
        description="مصروفات الفروع من فواتير الموردين — المبالغ شاملة الضريبة كما في الفاتورة."
        actions={
          <>
            {can("reports.view") && <LinkButton href={`/reports/purchases?${reportQs}`} variant="secondary">التقرير والتصدير</LinkButton>}
            {can("purchases.approve") && <LinkButton href="/purchases/categories" variant="secondary">التصنيفات</LinkButton>}
            {can("purchases.create") && <LinkButton href="/purchases/new" icon="plus">إضافة فاتورة</LinkButton>}
          </>
        }
      />

      <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="المعتمد (شامل الضريبة)" value={formatSAR(sums.approvedTotal)} hint={`${sums.approvedCount} فاتورة حسب التصفية`} icon="receipt" tone="good" />
        <StatCard label="ضريبة المشتريات المعتمدة" value={formatSAR(sums.approvedVat)} hint={`قبل الضريبة ${formatSAR(sums.approvedNet)}`} icon="finance" />
        <StatCard label="بانتظار المراجعة" value={formatSAR(sums.pendingTotal)} hint={`${sums.pendingCount} فاتورة`} icon="alert" tone="warn" />
        <StatCard label="معتمدة وغير مدفوعة" value={formatSAR(sums.unpaidTotal)} hint={`${sums.unpaidCount} فاتورة مستحقة للموردين`} icon="finance" tone="bad" />
      </div>

      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
          <div className="lg:col-span-2"><input name="q" defaultValue={filters.q} aria-label="بحث" placeholder="المورد، رقم الفاتورة، الرقم الداخلي…" className={inputClass} /></div>
          <select name="status" defaultValue={filters.status ?? ""} aria-label="الحالة" className={inputClass}>
            <option value="">كل الحالات</option>
            {Object.entries(PURCHASE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="pay" defaultValue={filters.pay ?? ""} aria-label="الدفع" className={inputClass}>
            <option value="">مدفوعة وغير مدفوعة</option>
            {Object.entries(PURCHASE_PAYMENT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select name="categoryId" defaultValue={filters.categoryId ?? ""} aria-label="التصنيف" className={inputClass}>
            <option value="">كل التصنيفات</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
          </select>
          <select name="branchId" defaultValue={filters.branchId ?? ""} aria-label="الفرع" className={inputClass}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
          <div className="flex flex-wrap gap-2 lg:col-span-6">
            <label className="flex items-center gap-2 text-sm text-gray-600">من <input type="date" name="from" defaultValue={filters.from} className={inputClass.replace("w-full", "w-40")} /></label>
            <label className="flex items-center gap-2 text-sm text-gray-600">إلى <input type="date" name="to" defaultValue={filters.to} className={inputClass.replace("w-full", "w-40")} /></label>
            <button className={buttonClass("primary")}>بحث</button>
            {Object.values(sp).some(Boolean) && <Link href="/purchases" className={buttonClass("ghost")}>مسح التصفية</Link>}
          </div>
        </form>
      </Card>

      <Card>
        {invoices.length === 0 ? (
          <EmptyState
            icon="receipt"
            title={total === 0 && !Object.values(sp).some(Boolean) ? "لا توجد فواتير شراء بعد" : "لا توجد فواتير مطابقة"}
            description="أضف فاتورة المورد مع صورتها، وتظهر هنا بعد الحفظ بانتظار مراجعة المحاسب."
            action={can("purchases.create") ? <LinkButton href="/purchases/new" icon="plus">إضافة فاتورة</LinkButton> : undefined}
          />
        ) : (
          <Table>
            <thead><tr><Th>الفاتورة</Th><Th>المورد</Th><Th>التصنيف</Th><Th>الإجمالي</Th><Th>الضريبة</Th><Th>التاريخ</Th><Th>الحالة</Th><Th>الدفع</Th></tr></thead>
            <tbody>
              {invoices.map((p) => (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/purchases/${p.id}`} dir="ltr" className="font-mono text-xs font-medium text-brand-700 hover:underline">{p.refNo}</Link>
                    <span className="block text-xs text-gray-400">{p.branch.nameAr}</span>
                  </Td>
                  <Td>{p.supplierName}<span dir="ltr" className="block text-end font-mono text-xs text-gray-400">#{p.invoiceNo}</span></Td>
                  <Td>{p.category.nameAr}</Td>
                  <Td className="tabular whitespace-nowrap font-semibold">{formatSAR(p.totalAmount)}</Td>
                  <Td className="tabular whitespace-nowrap text-gray-500">{formatSAR(p.vatAmount)}</Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(p.invoiceDate)}</Td>
                  <Td><Badge color={PURCHASE_STATUS_COLOR[p.status]}>{PURCHASE_STATUS_LABELS[p.status]}</Badge></Td>
                  <Td>{p.status === "APPROVED" ? <Badge color={PURCHASE_PAYMENT_COLOR[p.paymentStatus]}>{PURCHASE_PAYMENT_LABELS[p.paymentStatus]}</Badge> : <span className="text-xs text-gray-400">—</span>}</Td>
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
