import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { CHANNEL_LABELS, TENANT_STATUS_COLOR, TENANT_STATUS_LABELS, getTenant } from "@/services/tenants.service";
import { CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABELS } from "@/services/contracts.service";
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { ContactForm, InteractionForm, RemoveContactButton, SmallActionForm } from "../forms";
import { addContactAction, addInteractionAction, archiveTenantAction, removeContactAction } from "../actions";

export const metadata: Metadata = { title: "ملف العميل" };

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const actor = await requirePageActor("tenants.view");
  const { id } = await params;
  const { saved } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { tenant: t, balance, authorNames, createdByName, updatedByName, expiringSoon } = await getTenant(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  });
  const manage = actor.permissions.has("tenants.manage") && !t.archivedAt;
  const path = `/tenants/${id}`;
  const row = (label: string, value: React.ReactNode) => (
    <div><dt className="text-gray-500">{label}</dt><dd className="mt-1">{value ?? "—"}</dd></div>
  );

  return (
    <>
      <PageHeader
        title={t.name}
        description={`${t.type === "COMPANY" ? "منشأة" : "فرد"} · ${t.primaryBranch?.nameAr ?? "بدون فرع"}`}
        actions={
          <>
            {actor.permissions.has("contracts.create") && !t.archivedAt && <LinkButton href={`/contracts/new?tenantId=${t.id}`} icon="plus">عقد جديد</LinkButton>}
            {manage && <LinkButton href={`${path}/edit`} variant="secondary">تعديل</LinkButton>}
          </>
        }
      />
      {saved && <div className="mb-4"><Alert kind="success">تم حفظ بيانات العميل.</Alert></div>}
      {t.archivedAt && <div className="mb-4"><Alert kind="warning">هذا العميل مؤرشف منذ {formatDateTime(t.archivedAt)}.</Alert></div>}
      {expiringSoon.length > 0 && (
        <div className="mb-4"><Alert kind="warning">عقود تنتهي خلال 30 يومًا: {expiringSoon.map((c) => `${c.contractNo} (${formatDate(c.endDate)})`).join("، ")}</Alert></div>
      )}

      {balance && (
        <div className="stagger mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="المستحق حتى اليوم" value={formatSAR(balance.due)} icon="finance" />
          <StatCard label="المتأخر" value={formatSAR(balance.overdue)} icon="alert" tone="bad" />
          <StatCard label="أقساط قادمة" value={formatSAR(balance.future)} icon="finance" />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="البيانات" action={<Badge color={TENANT_STATUS_COLOR[t.status]}>{TENANT_STATUS_LABELS[t.status]}</Badge>} />
          <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
            {row("الشخص المسؤول", t.contactPersonName)}
            {row("الجوال", t.mobile && <a href={`tel:${t.mobile}`} dir="ltr" className="tabular text-brand-700">{t.mobile}</a>)}
            {row("البريد", t.email && <span dir="ltr">{t.email}</span>)}
            {row("السجل التجاري", t.crNumber && <span className="tabular">{t.crNumber}</span>)}
            {row("الرقم الضريبي", t.vatNumber && <span className="tabular">{t.vatNumber}</span>)}
            {row("رقم الهوية", t.nationalIdHidden ? <span className="text-gray-400">محجوب (بيانات حساسة)</span> : t.nationalId && <span className="tabular">{t.nationalId}</span>)}
            <div className="sm:col-span-3">{row("العنوان الوطني", t.nationalAddress)}</div>
            {t.notes && <div className="sm:col-span-3">{row("ملاحظات", <span className="whitespace-pre-line">{t.notes}</span>)}</div>}
            <div className="text-xs text-gray-400 sm:col-span-3">
              أضافه {createdByName ?? "—"} في {formatDateTime(t.createdAt)} · آخر تعديل {updatedByName ?? "—"} في {formatDateTime(t.updatedAt)}
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader title="جهات الاتصال" />
          <div className="space-y-4 p-5">
            {t.contacts.length === 0 ? <p className="text-sm text-gray-500">لا توجد جهات اتصال إضافية.</p> : (
              <ul className="space-y-2 text-sm">
                {t.contacts.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2">
                    <div>
                      <p className="font-medium">{c.name} {c.isPrimary && <Badge color="brand">أساسي</Badge>}</p>
                      <p className="text-xs text-gray-500">{[c.title, c.mobile, c.email].filter(Boolean).join(" · ")}</p>
                    </div>
                    {manage && <RemoveContactButton action={removeContactAction.bind(null, c.id, id)} />}
                  </li>
                ))}
              </ul>
            )}
            {manage && <div className="border-t border-gray-100 pt-4"><ContactForm action={addContactAction.bind(null, id)} /></div>}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="العقود" />
        {t.contracts.length === 0 ? (
          <EmptyState icon="contracts" title="لا توجد عقود" />
        ) : (
          <Table>
            <thead><tr><Th>رقم العقد</Th><Th>الفرع</Th><Th>الوحدات</Th><Th>من</Th><Th>إلى</Th><Th>القيمة</Th><Th>الحالة</Th></tr></thead>
            <tbody>
              {t.contracts.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <Td><Link href={`/contracts/${c.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{c.contractNo}</Link></Td>
                  <Td>{c.branch.nameAr}</Td>
                  <Td>{c.units.map((u) => u.unit.code).join("، ")}</Td>
                  <Td className="tabular">{formatDate(c.startDate)}</Td>
                  <Td className="tabular">{formatDate(c.endDate)}</Td>
                  <Td className="tabular">{formatSAR(c.totalAmount)}</Td>
                  <Td><Badge color={CONTRACT_STATUS_COLOR[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DocumentsPanel actor={actor} owner={{ tenantId: id }} path={path} categories={["COMMERCIAL_REGISTER", "VAT_CERTIFICATE", "ID_DOCUMENT", "OTHER"]} canUpload={!t.archivedAt} />
        <Card>
          <CardHeader title="سجل التواصل والملاحظات" />
          <div className="space-y-4 p-5">
            {!t.archivedAt && <InteractionForm action={addInteractionAction.bind(null, id)} />}
            {t.interactions.length === 0 ? <p className="text-sm text-gray-500">لا يوجد تواصل مسجل.</p> : (
              <ul className="space-y-3">
                {t.interactions.map((i) => (
                  <li key={i.id} className="border-s-2 border-accent-300 ps-3 text-sm">
                    <p className="text-gray-800">{i.body}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{CHANNEL_LABELS[i.channel as keyof typeof CHANNEL_LABELS] ?? i.channel} · {i.authorId ? authorNames[i.authorId] : "—"} · {formatDateTime(i.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      {actor.permissions.has("tenants.manage") && (
        <Card className="mt-6">
          <CardHeader title={t.archivedAt ? "استعادة العميل" : "أرشفة العميل"} />
          <div className="p-5">
            <p className="mb-3 text-sm text-gray-500">الأرشفة بديل الحذف: يختفي العميل من القوائم ويبقى سجله وعقوده. لا يمكن أرشفة عميل لديه عقود نشطة أو مسودات.</p>
            <SmallActionForm action={archiveTenantAction.bind(null, id, !t.archivedAt)} label={t.archivedAt ? "استعادة" : "أرشفة العميل"} confirm={t.archivedAt ? "استعادة العميل؟" : "أرشفة هذا العميل؟"} danger={!t.archivedAt} />
          </div>
        </Card>
      )}
    </>
  );
}
