import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { contractFormOptions, getContract } from "@/services/contracts.service";
import { Card, PageHeader } from "@/components/ui/primitives";
import { ContractForm, TermsForm } from "../../contract-form";
import { updateDraftAction, updateTermsAction } from "../../actions";

export const metadata: Metadata = { title: "تعديل العقد" };

export default async function EditContractPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("contracts.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { contract: c } = await getContract(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  if (c.status === "ACTIVE") {
    if (!actor.permissions.has("contracts.edit")) redirect("/forbidden");
    return (
      <>
        <PageHeader title={`تعديل شروط العقد ${c.contractNo}`} />
        <Card className="p-5 sm:p-6"><TermsForm action={updateTermsAction.bind(null, id)} terms={c.terms} notes={c.notes} /></Card>
      </>
    );
  }
  if (c.status !== "DRAFT") redirect(`/contracts/${id}`);
  const can = actor.permissions.has("contracts.edit") || (actor.permissions.has("contracts.create") && c.createdById === actor.id);
  if (!can) redirect("/forbidden");
  const opts = await contractFormOptions(prisma, actor);
  return (
    <>
      <PageHeader title={`تعديل المسودة ${c.contractNo}`} />
      <Card className="p-5 sm:p-6">
        <ContractForm
          action={updateDraftAction.bind(null, id)}
          {...opts}
          lockBranch
          initial={{
            tenantId: c.tenantId,
            branchId: c.branchId,
            startDate: c.startDate.toISOString().slice(0, 10),
            durationMonths: c.durationMonths,
            billingCycle: c.billingCycle,
            discountAmount: c.discountAmount.toFixed(2),
            terms: c.terms,
            notes: c.notes,
            units: c.units.map((u) => ({ unitId: u.unitId, seats: u.seats, monthlyPrice: u.price.toFixed(2) })),
          }}
        />
      </Card>
    </>
  );
}
