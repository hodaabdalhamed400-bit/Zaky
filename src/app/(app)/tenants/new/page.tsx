import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { Card, PageHeader } from "@/components/ui/primitives";
import { TenantForm } from "../forms";
import { createTenantAction } from "../actions";

export const metadata: Metadata = { title: "عميل جديد" };

export default async function NewTenantPage() {
  const actor = await requirePageActor("tenants.manage");
  const branches = await prisma.branch.findMany({ where: { status: { not: "INACTIVE" }, ...branchWhere(actor, "id") }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } });
  return (
    <>
      <PageHeader title="عميل جديد" description="يتحقق النظام من تكرار السجل التجاري والهوية والرقم الضريبي، ويُنبهك عند تطابق الجوال أو البريد." />
      <Card className="p-5 sm:p-6">
        <TenantForm action={createTenantAction} branches={branches} canSensitive={actor.permissions.has("tenants.view_sensitive")} />
      </Card>
    </>
  );
}
