import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "الفروع" };

export default async function BranchesPage() {
  const actor = await requirePageActor("branches.view");
  const branches = await prisma.branch.findMany({
    where: branchWhere(actor, "id"),
    orderBy: { code: "asc" },
    include: { _count: { select: { units: { where: { archivedAt: null } } } } },
  });

  return (
    <>
      <PageHeader title="الفروع" description="الفروع المصرح لك بالاطلاع عليها." />
      <div className="mb-4">
        <Alert kind="info">
          عرض للقراءة فقط في المرحلة الأولى. إضافة الفروع وتعديل بياناتها (المدينة، العنوان، المدير، رقم التواصل) تُفعَّل في المرحلة الثانية.
        </Alert>
      </div>
      <Card>
        {branches.length === 0 ? (
          <EmptyState title="لا توجد فروع متاحة لك" description="تواصل مع مسؤول النظام لمنحك صلاحية على الفروع." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الرمز</Th>
                <Th>الفرع</Th>
                <Th>المدينة</Th>
                <Th>المدير</Th>
                <Th>عدد الوحدات</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <Td><span dir="ltr" className="font-mono text-xs">{b.code}</span></Td>
                  <Td className="font-medium">{b.nameAr}</Td>
                  <Td>{b.city ?? <span className="text-gray-400">غير محدد</span>}</Td>
                  <Td>{b.managerName ?? <span className="text-gray-400">غير محدد</span>}</Td>
                  <Td className="tabular">{b._count.units}</Td>
                  <Td>{b.isActive ? <Badge color="green">نشط</Badge> : <Badge>موقوف</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
