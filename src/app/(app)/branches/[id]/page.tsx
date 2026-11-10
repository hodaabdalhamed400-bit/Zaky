import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatSAR } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { BRANCH_STATUS_COLOR as STATUS_COLOR, BRANCH_STATUS_LABELS, getBranch } from "@/services/branches.service";
import { UNIT_STATUS_LABELS } from "@/services/units.service";
import { getDashboardStats } from "@/services/dashboard.service";
import { Alert, Badge, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { OccupancyBreakdown } from "@/components/ui/occupancy";
import { DeleteFloorForm, FloorForm } from "../branch-form";
import { createFloorAction, deleteFloorAction } from "../actions";

export const metadata: Metadata = { title: "بيانات الفرع" };

export default async function BranchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const actor = await requirePageActor("branches.view");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getBranch(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const { branch, occupancy, activeContracts, activeContractsValue, unitsByStatus } = data;
  const money = actor.permissions.has("payments.view") ? await getDashboardStats(prisma, actor, { branchId: id }) : null;
  const canEdit = actor.permissions.has("branches.manage");
  const canFloors = actor.permissions.has("units.manage") && branch.status !== "INACTIVE";

  return (
    <>
      <PageHeader
        title={branch.nameAr}
        description={[branch.city, branch.address].filter(Boolean).join(" — ") || "العنوان غير مسجل"}
        actions={
          <>
            <LinkButton href={`/units?branchId=${branch.id}`} variant="secondary" icon="units">وحدات الفرع</LinkButton>
            {canEdit && <LinkButton href={`/branches/${branch.id}/edit`}>تعديل</LinkButton>}
          </>
        }
      />
      {saved && <div className="mb-4"><Alert kind="success">تم حفظ بيانات الفرع.</Alert></div>}
      {branch.status === "INACTIVE" && <div className="mb-4"><Alert kind="warning">هذا الفرع موقوف منذ {formatDateTime(branch.archivedAt)}. بياناته محفوظة للاطلاع والتقارير.</Alert></div>}

      <div className="stagger grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="إجمالي الوحدات" value={String(occupancy.units)} hint={`${unitsByStatus.MAINTENANCE ?? 0} صيانة · ${unitsByStatus.RESERVED ?? 0} محجوزة`} icon="units" />
        <StatCard label="الوحدات المؤجرة" value={String(occupancy.occupiedUnits)} icon="units" tone="good" />
        <StatCard label="العقود النشطة" value={String(activeContracts)} icon="contracts" />
        <StatCard label="قيمة العقود النشطة" value={formatSAR(activeContractsValue)} hint="إجمالي قيمة العقود، وليست إيرادًا" icon="contracts" />
        {money && (
          <>
            <StatCard label="المستحق حتى اليوم" value={formatSAR(money.dueAmount)} icon="finance" />
            <StatCard label="المحصّل هذا الشهر" value={formatSAR(money.collectedThisMonth)} hint="دفعات معتمدة فقط" icon="finance" tone="good" />
            <StatCard label="المتأخر" value={formatSAR(money.overdueAmount)} icon="alert" tone="bad" />
          </>
        )}
      </div>

      <Card className="mt-6 p-5">
        <p className="mb-3 text-sm font-semibold text-gray-900">الإشغال اليوم</p>
        <OccupancyBreakdown o={occupancy} />
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="بيانات الفرع" action={<Badge color={STATUS_COLOR[branch.status]}>{BRANCH_STATUS_LABELS[branch.status]}</Badge>} />
          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
            <div><dt className="text-gray-500">الرمز</dt><dd dir="ltr" className="mt-1 text-end font-mono">{branch.code}</dd></div>
            <div>
              <dt className="text-gray-500">المدير</dt>
              <dd className="mt-1">{branch.managerName ?? "لم يُحدد بعد"}{branch.managerActing && <span className="ms-1.5"><Badge color="blue">مؤقت</Badge></span>}</dd>
            </div>
            <div><dt className="text-gray-500">جهة التواصل</dt><dd className="mt-1">{branch.contactPerson ?? "—"}</dd></div>
            <div><dt className="text-gray-500">رقم التواصل</dt><dd className="mt-1">{branch.phone ? <a href={`tel:${branch.phone}`} dir="ltr" className="tabular text-brand-700 hover:underline">{branch.phone}</a> : "—"}</dd></div>
            <div className="sm:col-span-2">
              <dt className="text-gray-500">الموقع على الخريطة</dt>
              <dd className="mt-1">
                {branch.mapUrl ? (
                  <a href={branch.mapUrl} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">فتح الخريطة ↗</a>
                ) : "—"}
              </dd>
            </div>
            {branch.notes && <div className="sm:col-span-2"><dt className="text-gray-500">ملاحظات</dt><dd className="mt-1 whitespace-pre-line">{branch.notes}</dd></div>}
            <div className="sm:col-span-2 text-xs text-gray-400">آخر تحديث: {formatDateTime(branch.updatedAt)}</div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="الأدوار (الطوابق)" />
          <div className="space-y-4 p-5">
            {branch.floors.length === 0 ? (
              <p className="text-sm text-gray-500">لم تُسجَّل أدوار. الأدوار اختيارية وتساعد في تنظيم الوحدات.</p>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                {branch.floors.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>
                      {f.name} <span className="text-xs text-gray-400">({f._count.units} وحدة)</span>
                    </span>
                    {canFloors && f._count.units === 0 && <DeleteFloorForm action={deleteFloorAction.bind(null, f.id, branch.id)} />}
                  </li>
                ))}
              </ul>
            )}
            {canFloors && <FloorForm action={createFloorAction.bind(null, branch.id)} />}
          </div>
        </Card>
      </div>

      <p className="mt-6 text-sm">
        <Link href={`/units?branchId=${branch.id}`} className="text-brand-700 hover:underline">
          عرض وحدات الفرع ({Object.entries(unitsByStatus).map(([k, v]) => `${UNIT_STATUS_LABELS[k as keyof typeof UNIT_STATUS_LABELS]}: ${v}`).join("، ") || "لا توجد وحدات"})
        </Link>
      </p>
    </>
  );
}
