import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { hasBranchAccess } from "@/lib/rbac/guard";
import { Card, PageHeader } from "@/components/ui/primitives";
import { BranchForm } from "../../branch-form";
import { updateBranchAction } from "../../actions";

export const metadata: Metadata = { title: "تعديل الفرع" };

export default async function EditBranchPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("branches.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch || !hasBranchAccess(actor, id)) notFound();
  const contracts = await prisma.contract.count({ where: { branchId: id } });
  return (
    <>
      <PageHeader title={`تعديل: ${branch.nameAr}`} />
      <Card className="p-5 sm:p-6">
        <BranchForm action={updateBranchAction.bind(null, id)} initial={branch} codeLocked={contracts > 0} />
      </Card>
    </>
  );
}
