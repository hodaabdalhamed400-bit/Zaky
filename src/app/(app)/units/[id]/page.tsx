import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatSAR } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { PRICING_CYCLE_LABELS, effectiveUnitStatus, getUnit } from "@/services/units.service";
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { ArchiveUnitForm } from "../unit-form";
import { archiveUnitAction } from "../actions";

export const metadata: Metadata = { title: "بيانات الوحدة" };

const CONTRACT_STATUS: Record<string, string> = {
  DRAFT: "مسودة", PENDING_APPROVAL: "بانتظار الاعتماد", ACTIVE: "نشط", EXPIRED: "منتهي", CANCELLED: "ملغى", TERMINATED: "منهى", RENEWED: "مجدد",
};

export default async function UnitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const actor = await requirePageActor("units.view");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { unit, occupiedSeats, history } = await getUnit(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const st = effectiveUnitStatus(unit, occupiedSeats);
  const canManage = actor.permissions.has("units.manage");
  const showHistory = actor.permissions.has("audit.view") || canManage;

  return (
    <>
      <PageHeader
        title={`الوحدة ${unit.code}`}
        description={`${unit.branch.nameAr}${unit.floor ? ` · ${unit.floor.name}` : ""} · ${unit.unitType.nameAr}`}
        actions={canManage && !unit.archivedAt ? <LinkButton href={`/units/${unit.id}/edit`}>تعديل</LinkButton> : undefined}
      />
      {saved && <div className="mb-4"><Alert kind="success">تم حفظ بيانات الوحدة.</Alert></div>}
      {unit.unitType.leaseMode === "BOOKING" && (
        <div className="mb-4">
          <Alert kind="info">هذه الوحدة تُدار بحجوزات منفصلة بالساعة أو اليوم وليس بعقود، ولا تدخل في نسب إشغال العقود. وحدة الحجوزات لم تُبنَ بعد.</Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="البيانات" action={<Badge color={st.color}>{st.label}</Badge>} />
          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
            <div><dt className="text-gray-500">الفرع</dt><dd className="mt-1"><Link href={`/branches/${unit.branch.id}`} className="text-brand-700 hover:underline">{unit.branch.nameAr}</Link></dd></div>
            <div><dt className="text-gray-500">الدور</dt><dd className="mt-1">{unit.floor?.name ?? "—"}</dd></div>
            <div><dt className="text-gray-500">النوع</dt><dd className="mt-1">{unit.unitType.nameAr} <span className="text-xs text-gray-400">({unit.occupancyMode === "SHARED" ? "مشتركة" : "حصرية"})</span></dd></div>
            <div><dt className="text-gray-500">المساحة</dt><dd className="tabular mt-1">{unit.areaSqm ? `${unit.areaSqm.toFixed(2)} م²` : "غير مسجلة"}</dd></div>
            <div><dt className="text-gray-500">{unit.occupancyMode === "SHARED" ? "المقاعد" : "السعة"}</dt><dd className="tabular mt-1">{unit.occupancyMode === "SHARED" ? `${occupiedSeats} مؤجرة من ${unit.capacity}` : unit.capacity}</dd></div>
            <div><dt className="text-gray-500">السعر الأساسي</dt><dd className="tabular mt-1">{formatSAR(unit.basePrice)} / {PRICING_CYCLE_LABELS[unit.pricingCycle]} <span className="text-xs text-gray-400">شامل الضريبة</span></dd></div>
            {unit.description && <div className="sm:col-span-3"><dt className="text-gray-500">الوصف</dt><dd className="mt-1 whitespace-pre-line">{unit.description}</dd></div>}
            <div className="text-xs text-gray-400 sm:col-span-3">آخر تحديث: {formatDateTime(unit.updatedAt)}</div>
          </dl>
        </Card>
        <div className="space-y-6">
          {canManage && (
            <Card>
              <CardHeader title={unit.archivedAt ? "وحدة مؤرشفة" : "الأرشفة"} />
              <div className="p-5"><ArchiveUnitForm action={archiveUnitAction.bind(null, unit.id, !unit.archivedAt)} archived={!!unit.archivedAt} /></div>
            </Card>
          )}
          <Card>
            <CardHeader title="الصور والمرفقات" />
            <p className="p-5 text-sm text-gray-500">رفع الصور والمرفقات يُفعَّل في المرحلة الثالثة مع التخزين الآمن للملفات.</p>
          </Card>
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader title="سجل الإشغال" />
        {unit.contractUnits.length === 0 ? (
          <EmptyState title="لم تُؤجر هذه الوحدة بعد" description="يظهر هنا كل عقد ارتبطت به الوحدة (يُفعَّل مع العقود في المرحلة الثالثة)." />
        ) : (
          <Table>
            <thead><tr><Th>العقد</Th><Th>المستأجر</Th><Th>من</Th><Th>إلى</Th><Th>المقاعد</Th><Th>حالة العقد</Th></tr></thead>
            <tbody>
              {unit.contractUnits.map((cu) => (
                <tr key={cu.id}>
                  <Td><span dir="ltr" className="font-mono text-xs">{cu.contract.contractNo}</span></Td>
                  <Td>{cu.contract.tenant.name}</Td>
                  <Td className="tabular">{formatDate(cu.startDate)}</Td>
                  <Td className="tabular">{formatDate(cu.endDate)}</Td>
                  <Td className="tabular">{cu.seats}</Td>
                  <Td>{CONTRACT_STATUS[cu.contract.status]}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {showHistory && (
        <Card className="mt-6">
          <CardHeader title="سجل التعديلات" />
          {history.length === 0 ? (
            <EmptyState title="لا توجد تعديلات مسجلة" />
          ) : (
            <ul className="divide-y divide-gray-100">
              {history.map((h) => (
                <li key={h.id.toString()} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span><span className="font-medium">{h.user?.name ?? "النظام"}</span> <span className="text-gray-500">— {AUDIT_ACTION_LABELS[h.action] ?? h.action}</span></span>
                  <span className="tabular text-xs text-gray-400">{formatDateTime(h.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
