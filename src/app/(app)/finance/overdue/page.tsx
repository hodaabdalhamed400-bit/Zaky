import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { formatDate } from "@/lib/dates";
import { formatSAR, sum } from "@/lib/money";
import { overdueReport } from "@/services/finance.service";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, buttonClass, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "المتأخرات" };

export default async function OverduePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor("payments.view");
  const sp = await searchParams;
  const [rows, branches] = await Promise.all([
    overdueReport(prisma, actor, sp),
    prisma.branch.findMany({ where: branchWhere(actor, "id"), orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
  ]);
  const total = sum(rows.map((r) => r.overdue));
  return (
    <>
      <PageHeader title="المستأجرون المتأخرون" description={`${rows.length} عقد متأخر · الإجمالي ${formatSAR(total)} · مرتبة حسب أقدم استحقاق`} />
      {branches.length > 1 && (
        <Card className="mb-4">
          <form className="flex gap-2 p-4">
            <select name="branchId" defaultValue={sp.branchId ?? ""} aria-label="الفرع" className={inputClass.replace("w-full", "w-56")}>
              <option value="">كل الفروع</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
            <button className={buttonClass("primary")}>عرض</button>
          </form>
        </Card>
      )}
      <Card>
        {rows.length === 0 ? (
          <EmptyState icon="check" title="لا توجد متأخرات" />
        ) : (
          <Table>
            <thead><tr><Th>المستأجر</Th><Th>العقد</Th><Th>الفرع</Th><Th>المتأخر</Th><Th>أقدم استحقاق</Th><Th>أيام التأخير</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.contractId} className="hover:bg-gray-50">
                  <Td><Link href={`/tenants/${r.tenantId}`} className="font-medium text-brand-700 hover:underline">{r.tenant}</Link>{r.mobile && <a href={`tel:${r.mobile}`} dir="ltr" className="tabular block text-xs text-gray-500">{r.mobile}</a>}</Td>
                  <Td><Link href={`/contracts/${r.contractId}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{r.contractNo}</Link></Td>
                  <Td>{r.branch}</Td>
                  <Td className="tabular whitespace-nowrap font-semibold text-red-700">{formatSAR(r.overdue)}<span className="block text-xs font-normal text-gray-400">{r.installments} قسط</span></Td>
                  <Td className="tabular whitespace-nowrap">{formatDate(r.oldestDue)}</Td>
                  <Td><Badge color={r.daysLate > 60 ? "red" : r.daysLate > 30 ? "amber" : "gray"}>{r.daysLate} يوم</Badge></Td>
                  <Td>{actor.permissions.has("payments.record") && <Link href={`/finance/payments/new?contractId=${r.contractId}`} className="text-xs text-brand-700 hover:underline">تسجيل دفعة</Link>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
