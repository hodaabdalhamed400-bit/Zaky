import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { Alert, Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "الفروع" };

const STATUS = {
  ACTIVE: { label: "عامل", color: "green" },
  PREPARING: { label: "قيد التجهيز", color: "amber" },
  INACTIVE: { label: "موقوف", color: "gray" },
} as const;

export default async function BranchesPage() {
  const actor = await requirePageActor("branches.view");
  const branches = await prisma.branch.findMany({
    where: branchWhere(actor, "id"),
    // العاملة أولًا ثم قيد التجهيز ثم الموقوفة
    orderBy: [{ status: "asc" }, { nameAr: "asc" }],
    include: { _count: { select: { units: { where: { archivedAt: null } } } } },
  });

  return (
    <>
      <PageHeader title="الفروع" description="الفروع المصرح لك بالاطلاع عليها." />
      <div className="mb-4">
        <Alert kind="info">
          عرض للقراءة فقط في المرحلة الأولى. إضافة الفروع وتعديل بياناتها (العنوان، رابط الخريطة، المدير) تُفعَّل في المرحلة الثانية.
        </Alert>
      </div>
      <Card>
        {branches.length === 0 ? (
          <EmptyState title="لا توجد فروع متاحة لك" description="تواصل مع مسؤول النظام لمنحك صلاحية على الفروع." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الفرع</Th>
                <Th>الرمز</Th>
                <Th>المدينة</Th>
                <Th>المدير</Th>
                <Th>رقم التواصل</Th>
                <Th>عدد الوحدات</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id}>
                  <Td className="font-medium">{b.nameAr}</Td>
                  <Td><span dir="ltr" className="font-mono text-xs">{b.code}</span></Td>
                  <Td>{b.city ?? <span className="text-gray-400">غير محدد</span>}</Td>
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
                  <Td>{b.phone ? <a href={`tel:${b.phone}`} dir="ltr" className="tabular text-brand-700 hover:underline">{b.phone}</a> : "—"}</Td>
                  <Td className="tabular">{b._count.units}</Td>
                  <Td><Badge color={STATUS[b.status].color}>{STATUS[b.status].label}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
