import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { getBranchScene } from "@/services/branch-scene.service";
import { Alert, Card, LinkButton, PageHeader } from "@/components/ui/primitives";
import { BranchScene } from "@/components/branch3d/branch-scene";
import { TONE } from "@/components/branch3d/tones";
import { OccupancyRing } from "@/components/ui/occupancy-ring";

export const metadata: Metadata = { title: "المجسم ثلاثي الأبعاد" };

export default async function Branch3DPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("units.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const scene = await getBranchScene(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const canEdit = actor.permissions.has("units.manage");
  const occupied = scene.counts.rented + scene.counts.expiring + scene.counts.partial;
  const pct = scene.total ? Math.round((occupied / scene.total) * 1000) / 10 : null;
  const legend = (Object.keys(TONE) as (keyof typeof TONE)[]).filter((k) => k !== "facility" && scene.counts[k] > 0);

  return (
    <>
      <PageHeader
        title={`${scene.branch.nameAr} — المجسم ثلاثي الأبعاد`}
        description="شكل الفرع من الداخل بحالة كل مكتب الآن: لفّ وقرّب، ومرّر على أي مكتب لترى تفاصيله."
        actions={
          <>
            <LinkButton href={`/branches/${id}`} variant="secondary">بيانات الفرع</LinkButton>
            {canEdit && <LinkButton href={`/branches/${id}/layout`} icon="move">محرر المخطط</LinkButton>}
          </>
        }
      />

      {scene.total === 0 && !scene.hasPlan ? (
        <Card className="p-8 text-center text-sm text-gray-600">
          لا توجد وحدات في هذا الفرع بعد. أضف المكاتب والقاعات من «المكاتب والوحدات» ليظهر المجسم.
          <div className="mt-4"><LinkButton href={`/units/new?branchId=${id}`} icon="plus">إضافة وحدة</LinkButton></div>
        </Card>
      ) : (
        <>
          {scene.hasPlan && (
            <div className="mb-4">
              <Alert kind="info">
                المجسم مبني من المخطط المعماري للفرع.{" "}
                {scene.unregisteredCodes.length > 0
                  ? (
                    <>
                      {`${scene.unregisteredCodes.length} غرفة بالرمادي غير مسجلة في النظام بعد — سجّلها في «المكاتب والوحدات» بنفس الأرقام لتظهر حالتها. `}
                      <details className="mt-1 inline">
                        <summary className="cursor-pointer font-semibold underline">عرض الأرقام</summary>
                        <span className="tabular block pt-1">{scene.unregisteredCodes.join("، ")}</span>
                      </details>
                    </>
                  )
                  : "كل غرف المخطط مسجلة في النظام."}
                {scene.unmatchedCodes.length > 0 && (
                  <span className="mt-1 block">
                    {`${scene.unmatchedCodes.length} وحدة مسجلة أرقامها غير موجودة في المخطط فلا تظهر في المجسم — عدّل رقمها في «المكاتب والوحدات» إلى رقمها في المخطط: `}
                    <span className="tabular">{scene.unmatchedCodes.join("، ")}</span>
                  </span>
                )}
              </Alert>
            </div>
          )}
          {!scene.hasPlan && scene.placedCount < scene.total && (
            <div className="mb-4">
              <Alert kind="info">
                {scene.placedCount === 0 ? "المكاتب مرتبة تلقائيًا." : `${scene.total - scene.placedCount} وحدة مرتبة تلقائيًا.`}{" "}
                {canEdit ? "ارسم مكانها الحقيقي من «محرر المخطط» — ويمكنك وضع صورة مخطط الفرع خلفية للرسم فوقها." : "يمكن لمدير الفرع رسم المخطط الحقيقي."}
              </Alert>
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
            <BranchScene floors={scene.floors} />
            <Card className="h-fit">
              <div className="flex flex-col items-center gap-3 p-5">
                <OccupancyRing pct={pct} size={110} stroke={9} label="الإشغال" />
                <p className="tabular text-xs text-gray-500">{scene.total ? `${occupied} من ${scene.total} وحدة مؤجرة` : "لا توجد وحدات مسجلة بعد"}</p>
                <ul className="w-full space-y-1.5 text-sm" aria-label="دليل الألوان">
                  {legend.map((k) => (
                    <li key={k} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-1.5">
                      <span className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: TONE[k].color }} />{TONE[k].label}</span>
                      <span className="tabular font-semibold text-gray-800">{scene.counts[k]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
