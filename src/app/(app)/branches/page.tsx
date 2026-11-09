import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { BRANCH_STATUS_COLOR as STATUS_COLOR, BRANCH_STATUS_LABELS, listBranches } from "@/services/branches.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { OccupancyBar, OccupancyBreakdown } from "@/components/ui/occupancy";

export const metadata: Metadata = { title: "الفروع" };

export default async function BranchesPage() {
  const actor = await requirePageActor("branches.view");
  const { branches, total } = await listBranches(prisma, actor);
  const canCreate = actor.permissions.has("branches.manage") && actor.allBranches;

  return (
    <>
      <PageHeader
        title="الفروع"
        description="الفروع المصرح لك بها مع نسب الإشغال اليوم."
        actions={
          <>
            {actor.permissions.has("branches.manage") && <LinkButton href="/units/types" variant="secondary">أنواع الوحدات</LinkButton>}
            {canCreate && <LinkButton href="/branches/new" icon="plus">فرع جديد</LinkButton>}
          </>
        }
      />

      {branches.length > 0 && (
        <Card className="mb-6 p-5">
          <p className="mb-3 text-sm font-semibold text-gray-900">الإشغال الإجمالي للفروع المعروضة</p>
          <OccupancyBreakdown o={total} />
        </Card>
      )}

      <Card>
        {branches.length === 0 ? (
          <EmptyState title="لا توجد فروع متاحة لك" description="تواصل مع مسؤول النظام لمنحك صلاحية على الفروع." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الفرع</Th>
                <Th>المدير</Th>
                <Th>الوحدات</Th>
                <Th>الإشغال (وحدات)</Th>
                <Th>الإشغال (مقاعد)</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <Td>
                    <Link href={`/branches/${b.id}`} className="font-medium text-brand-700 hover:underline">{b.nameAr}</Link>
                    <span className="block text-xs text-gray-400">{b.city ?? "مدينة غير محددة"} · <span dir="ltr" className="font-mono">{b.code}</span></span>
                  </Td>
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
                  <Td className="tabular">
                    {b.occupancy.units}
                    <span className="block text-xs text-gray-400">{b.occupancy.occupiedUnits} مؤجرة</span>
                  </Td>
                  <Td><OccupancyBar pct={b.occupancy.unitsPct} /></Td>
                  <Td><OccupancyBar pct={b.occupancy.seatsPct} /></Td>
                  <Td><Badge color={STATUS_COLOR[b.status]}>{BRANCH_STATUS_LABELS[b.status]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
