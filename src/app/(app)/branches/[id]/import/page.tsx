import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { hasBranchAccess } from "@/lib/rbac/guard";
import { IMPORT_PERMISSIONS } from "@/services/branch-import.service";
import { Alert, Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { ImportForm } from "./import-form";
import { importAction } from "./actions";

export const metadata: Metadata = { title: "استيراد بيانات الفرع" };

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("units.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const branch = await prisma.branch.findUnique({ where: { id } });
  if (!branch || !hasBranchAccess(actor, id)) notFound();
  const missing = IMPORT_PERMISSIONS.filter((p) => !actor.permissions.has(p));
  return (
    <>
      <PageHeader
        title={`استيراد بيانات ${branch.nameAr}`}
        description="ارفع شيت «بيانات الفرع» بعد تعبئته: يُراجع النظام كل سطر ويعرض لك ما سيُضاف والأخطاء قبل أي حفظ."
        actions={<LinkButton href={`/branches/${id}`} variant="secondary" icon="arrowLeft">بيانات الفرع</LinkButton>}
      />
      {missing.length ? (
        <Alert kind="warning">الاستيراد يسجل وحدات وعملاء وعقودًا ودفعات معتمدة، لذلك يحتاج صلاحيات الإدارة كاملة (مدير النظام أو المدير العام).</Alert>
      ) : branch.status === "INACTIVE" ? (
        <Alert kind="warning">الفرع موقوف — فعّله أولًا.</Alert>
      ) : (
        <Card className="p-5 sm:p-6">
          <ImportForm action={importAction.bind(null, id)} branchId={id} branchName={branch.nameAr} />
        </Card>
      )}
    </>
  );
}
