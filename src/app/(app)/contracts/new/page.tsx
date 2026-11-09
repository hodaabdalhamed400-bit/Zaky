import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { contractFormOptions } from "@/services/contracts.service";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui/primitives";
import { ContractForm } from "../contract-form";
import { createContractAction } from "../actions";

export const metadata: Metadata = { title: "عقد جديد" };

export default async function NewContractPage({ searchParams }: { searchParams: Promise<{ tenantId?: string }> }) {
  const actor = await requirePageActor("contracts.create");
  const { tenantId } = await searchParams;
  const opts = await contractFormOptions(prisma, actor);
  return (
    <>
      <PageHeader title="عقد جديد" description="يُحفظ كمسودة، ثم يُرسل للاعتماد فتُحجز الوحدات، ثم يُعتمد فيُنشأ جدول الأقساط." />
      <Card className="p-5 sm:p-6">
        {opts.tenants.length === 0 ? (
          <EmptyState icon="tenants" title="لا يوجد عملاء" description="أنشئ ملف العميل أولًا." action={actor.permissions.has("tenants.manage") ? <LinkButton href="/tenants/new">عميل جديد</LinkButton> : undefined} />
        ) : (
          <ContractForm action={createContractAction} {...opts} defaultTenantId={opts.tenants.some((t) => t.id === tenantId) ? tenantId : undefined} />
        )}
      </Card>
    </>
  );
}
