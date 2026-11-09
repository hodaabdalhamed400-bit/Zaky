import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { Badge, Card, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { TypeForm, ToggleTypeForm } from "./type-forms";
import { createUnitTypeAction, toggleUnitTypeAction } from "../actions";

export const metadata: Metadata = { title: "أنواع الوحدات" };

export default async function UnitTypesPage() {
  await requirePageActor("branches.manage");
  const types = await prisma.unitType.findMany({
    orderBy: [{ isSystem: "desc" }, { nameAr: "asc" }],
    include: { _count: { select: { units: true } } },
  });
  return (
    <>
      <PageHeader title="أنواع الوحدات" description="الأنواع الأساسية وأي نوع مخصص تحتاجه الشركة. النوع المعطل لا يُستخدم في وحدات جديدة." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <thead><tr><Th>النوع</Th><Th>الإشغال</Th><Th>عدد الوحدات</Th><Th>الحالة</Th><Th /></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.nameAr}{t.isSystem && <span className="ms-1.5"><Badge>أساسي</Badge></span>}</Td>
                  <Td>
                    {t.occupancyMode === "SHARED" ? "مشتركة (بالمقاعد)" : "حصرية"}
                    <span className="block text-xs text-gray-400">{t.leaseMode === "BOOKING" ? "حجوزات بالساعة/اليوم" : "بعقود"}</span>
                  </Td>
                  <Td className="tabular">{t._count.units}</Td>
                  <Td>{t.isActive ? <Badge color="green">مفعل</Badge> : <Badge>معطل</Badge>}</Td>
                  <Td><ToggleTypeForm action={toggleUnitTypeAction.bind(null, t.id, !t.isActive)} active={t.isActive} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="نوع مخصص جديد" />
          <div className="p-5"><TypeForm action={createUnitTypeAction} /></div>
        </Card>
      </div>
    </>
  );
}
