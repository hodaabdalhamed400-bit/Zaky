import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { getBranchScene } from "@/services/branch-scene.service";
import { Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { LayoutEditor } from "@/components/branch3d/layout-editor";
import { resetLayoutAction, saveLayoutAction } from "./actions";

export const metadata: Metadata = { title: "محرر مخطط الفرع" };

export default async function LayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("units.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const scene = await getBranchScene(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  return (
    <>
      <PageHeader
        title={`مخطط ${scene.branch.nameAr}`}
        description="ارسم مكان كل مكتب وقاعة ومقاسه بالأمتار — المجسم ثلاثي الأبعاد يُبنى من هذا المخطط. يمكنك وضع صورة مخطط الفرع خلفية والرسم فوقها."
        actions={<LinkButton href={`/branches/${id}/3d`} variant="secondary" icon="cube">المجسم 3D</LinkButton>}
      />
      {scene.total === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-600">
          لا توجد وحدات مسجلة في هذا الفرع بعد.{scene.hasPlan ? " المخطط المعماري للفرع جاهز — سجّل الوحدات بأرقام المخطط وستأخذ أماكنها تلقائيًا." : ""}
        </Card>
      ) : (
        <LayoutEditor branchId={id} floors={scene.floors} saveAction={saveLayoutAction.bind(null, id)} resetAction={resetLayoutAction.bind(null, id)} />
      )}
    </>
  );
}
