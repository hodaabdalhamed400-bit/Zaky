import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { listCategories } from "@/services/purchases.service";
import { Badge, Card, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { OpButton } from "../../contracts/op-forms";
import { CategoryForm } from "../purchase-form";
import { createCategoryAction, toggleCategoryAction } from "../actions";

export const metadata: Metadata = { title: "تصنيفات المصروفات" };

export default async function CategoriesPage() {
  await requirePageActor("purchases.approve");
  const categories = await listCategories(prisma, { includeInactive: true });
  return (
    <>
      <PageHeader title="تصنيفات المصروفات" description="التصنيفات التي يختار منها الموظفون عند إضافة فاتورة شراء. التصنيف الموقوف لا يظهر في الفواتير الجديدة ويبقى في القديمة." />
      <Card className="mb-6">
        <div className="p-5"><CategoryForm action={createCategoryAction} /></div>
      </Card>
      <Card>
        <CardHeader title={`${categories.length} تصنيف`} />
        <Table>
          <thead><tr><Th>التصنيف</Th><Th>عدد الفواتير</Th><Th>الحالة</Th><Th /></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.nameAr}</Td>
                <Td className="tabular">{c._count.invoices}</Td>
                <Td><Badge color={c.isActive ? "green" : "gray"}>{c.isActive ? "مفعّل" : "موقوف"}</Badge></Td>
                <Td className="w-40">
                  <OpButton
                    action={toggleCategoryAction.bind(null, c.id, !c.isActive)}
                    label={c.isActive ? "إيقاف" : "تفعيل"}
                    confirm={c.isActive ? `إيقاف تصنيف «${c.nameAr}»؟` : `تفعيل تصنيف «${c.nameAr}»؟`}
                    variant="secondary"
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
