import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { unitFormOptions } from "@/services/units.service";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { UnitForm } from "../unit-form";
import { createUnitAction } from "../actions";

export const metadata: Metadata = { title: "وحدة جديدة" };

export default async function NewUnitPage({ searchParams }: { searchParams: Promise<{ branchId?: string; added?: string }> }) {
  const actor = await requirePageActor("units.manage");
  const { branchId, added } = await searchParams;
  const { branches, types } = await unitFormOptions(prisma, actor);
  return (
    <>
      <PageHeader title="وحدة جديدة" description="مكتب خاص، مكتب مشترك، قاعة اجتماعات، مساحة إدارية أو نوع مخصص." />
      {added && <div className="mb-4"><Alert kind="success">تم حفظ الوحدة. يمكنك إضافة الوحدة التالية.</Alert></div>}
      <Card className="p-5 sm:p-6">
        {branches.length === 0 ? (
          <EmptyState title="لا توجد فروع متاحة لك لإضافة وحدات" />
        ) : (
          <UnitForm key={added ?? "new"} mode="create" action={createUnitAction} branches={branches} types={types} defaultBranchId={branches.some((b) => b.id === branchId) ? branchId : undefined} />
        )}
      </Card>
    </>
  );
}
