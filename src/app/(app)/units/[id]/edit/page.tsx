import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { getUnit, unitFormOptions } from "@/services/units.service";
import { Card, PageHeader } from "@/components/ui/primitives";
import { UnitForm } from "../../unit-form";
import { updateUnitAction } from "../../actions";

export const metadata: Metadata = { title: "تعديل الوحدة" };

export default async function EditUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("units.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { unit } = await getUnit(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  if (unit.archivedAt) notFound();
  const { branches, types } = await unitFormOptions(prisma, actor);
  return (
    <>
      <PageHeader title={`تعديل الوحدة ${unit.code}`} description={unit.branch.nameAr} />
      <Card className="p-5 sm:p-6">
        <UnitForm
          mode="edit"
          action={updateUnitAction.bind(null, unit.id)}
          branches={branches}
          types={types}
          initial={{
            branchId: unit.branchId,
            floorId: unit.floorId,
            unitTypeId: unit.unitTypeId,
            code: unit.code,
            areaSqm: unit.areaSqm?.toFixed(2) ?? null,
            capacity: unit.capacity,
            basePrice: unit.basePrice.toFixed(2),
            pricingCycle: unit.pricingCycle,
            description: unit.description,
            status: unit.status,
          }}
        />
      </Card>
    </>
  );
}
