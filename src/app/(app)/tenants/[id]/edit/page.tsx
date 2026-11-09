import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { AppError } from "@/lib/errors";
import { getTenant } from "@/services/tenants.service";
import { Card, PageHeader } from "@/components/ui/primitives";
import { TenantForm } from "../../forms";
import { updateTenantAction } from "../../actions";

export const metadata: Metadata = { title: "تعديل العميل" };

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("tenants.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { tenant } = await getTenant(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  if (tenant.archivedAt) notFound();
  const branches = await prisma.branch.findMany({ where: { status: { not: "INACTIVE" }, ...branchWhere(actor, "id") }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } });
  return (
    <>
      <PageHeader title={`تعديل: ${tenant.name}`} />
      <Card className="p-5 sm:p-6">
        <TenantForm action={updateTenantAction.bind(null, id)} branches={branches} initial={tenant} canSensitive={actor.permissions.has("tenants.view_sensitive")} nationalIdHidden={tenant.nationalIdHidden} />
      </Card>
    </>
  );
}
