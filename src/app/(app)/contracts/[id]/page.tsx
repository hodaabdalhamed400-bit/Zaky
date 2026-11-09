import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, isOverdue } from "@/lib/dates";
import { formatSAR, sum } from "@/lib/money";
import { BILLING_CYCLE_LABELS } from "@/lib/contract-pricing";
import { CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABELS, getContract } from "@/services/contracts.service";
import { Alert, Badge, Card, CardHeader, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui/primitives";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { OpButton, ReasonOp, TerminateForm } from "../op-forms";
import { contractOpAction } from "../actions";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_COLOR, PAYMENT_STATUS_LABELS } from "@/services/payments.service";
import { AdjustmentForm } from "../../finance/payment-form";
import { adjustmentAction } from "../../finance/actions";

export const metadata: Metadata = { title: "تفاصيل العقد" };

const DONE: Record<string, string> = {
  created: "تم حفظ العقد كمسودة.",
  saved: "تم حفظ التعديلات.",
  submit: "أُرسل العقد للاعتماد وحُجزت الوحدات.",
  approve: "تم اعتماد العقد وإنشاء جدول الأقساط.",
  reject: "أُعيد العقد للتعديل.",
  cancel: "تم إلغاء العقد وتحرير الوحدات.",
  renew: "تم إنشاء مسودة التجديد. راجع السعر حسب الاتفاق ثم أرسلها للاعتماد.",
  terminate: "تم إنهاء العقد.",
};
const SCHED: Record<string, { label: string; color: "gray" | "green" | "amber" | "red" | "blue" }> = {
  PENDING: { label: "غير مسدد", color: "gray" },
  PARTIAL: { label: "مسدد جزئيًا", color: "amber" },
  PAID: { label: "مسدد", color: "green" },
  WAIVED: { label: "معفى", color: "blue" },
  CANCELLED: { label: "ملغى", color: "gray" },
};

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> }) {
  const actor = await requirePageActor("contracts.view");
  const { id } = await params;
  const { done } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { contract: c, userNames } = await getContract(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const p = actor.permissions;
  const isCreator = c.createdById === actor.id;
  const canDraft = p.has("contracts.edit") || (p.has("contracts.create") && isCreator);
  const start = c.startDate.toISOString().slice(0, 10);
  const end = c.endDate.toISOString().slice(0, 10);
  const op = (o: Parameters<typeof contractOpAction>[1]) => contractOpAction.bind(null, id, o);
  const showMoney = p.has("payments.view");
  const remaining = sum(c.schedules.filter((s) => s.status === "PENDING" || s.status === "PARTIAL").map((s) => s.amountDue.minus(s.amountPaid).minus(s.amountAdjusted)));

  const payments = showMoney ? await prisma.payment.findMany({ where: { contractId: id }, orderBy: { createdAt: "desc" } }) : [];
  const openInst = c.schedules
    .filter((s) => s.status === "PENDING" || s.status === "PARTIAL")
    .map((s) => ({ id: s.id, seqNo: s.seqNo, dueDate: s.dueDate.toISOString().slice(0, 10), remaining: s.amountDue.minus(s.amountPaid).minus(s.amountAdjusted).toFixed(2) }));

  const actions: React.ReactNode[] = [];
  if (p.has("payments.record") && openInst.length > 0) actions.push(<LinkButton key="pay" href={`/finance/payments/new?contractId=${id}`} icon="finance">تسجيل دفعة</LinkButton>);
  if (c.status === "DRAFT" && canDraft) {
    actions.push(<LinkButton key="e" href={`/contracts/${id}/edit`} variant="secondary">تعديل المسودة</LinkButton>);
    actions.push(<OpButton key="s" action={op("submit")} label="إرسال للاعتماد" confirm="إرسال العقد للاعتماد؟ ستُحجز الوحدات." />);
  }
  if (c.status === "PENDING_APPROVAL" && p.has("contracts.approve")) {
    actions.push(<OpButton key="a" action={op("approve")} label="اعتماد العقد" confirm={`اعتماد العقد بإجمالي ${formatSAR(c.totalAmount)}؟ سيُنشأ جدول الأقساط.`} />);
    actions.push(<ReasonOp key="r" action={op("reject")} label="إرجاع للتعديل" placeholder="سبب الإرجاع…" />);
  }
  if ((c.status === "DRAFT" || c.status === "PENDING_APPROVAL") && (p.has("contracts.terminate") || canDraft))
    actions.push(<ReasonOp key="c" action={op("cancel")} label="إلغاء العقد" placeholder="سبب الإلغاء…" variant="danger" />);
  if (c.status === "ACTIVE" && p.has("contracts.edit")) actions.push(<LinkButton key="t" href={`/contracts/${id}/edit`} variant="secondary">تعديل الشروط</LinkButton>);
  if ((c.status === "ACTIVE" || c.status === "EXPIRED") && p.has("contracts.create") && (!c.renewedBy || c.renewedBy.status === "CANCELLED"))
    actions.push(<OpButton key="n" action={op("renew")} label="إنشاء مسودة تجديد" confirm="إنشاء مسودة تجديد بنفس الوحدات والمدة؟" variant="secondary" />);
  if (c.status === "ACTIVE" && p.has("contracts.terminate")) actions.push(<TerminateForm key="x" action={op("terminate")} minDate={start} maxDate={end} />);

  return (
    <>
      <PageHeader
        title={`العقد ${c.contractNo}`}
        description={`${c.tenant.name} · ${c.branch.nameAr}`}
        actions={<LinkButton href={`/print/contracts/${id}`} variant="secondary">نسخة للطباعة / PDF</LinkButton>}
      />
      {done && DONE[done] && <div className="mb-4"><Alert kind="success">{DONE[done]}</Alert></div>}
      {c.rejectionReason && c.status === "DRAFT" && <div className="mb-4"><Alert kind="warning">أُعيد للتعديل: {c.rejectionReason}</Alert></div>}
      {c.status === "TERMINATED" && (
        <div className="mb-4"><Alert kind="warning">أُنهي مبكرًا بتاريخ {formatDate(c.endedAt)} — {c.endReason}. الأقساط القادمة: {c.earlyExitPolicy === "CANCEL_FUTURE" ? "أُلغيت" : "بقيت مستحقة"}. لا يُسترد أي مبلغ مدفوع.</Alert></div>
      )}
      {c.status === "CANCELLED" && c.endReason && <div className="mb-4"><Alert kind="warning">ملغى: {c.endReason}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="بيانات العقد" action={<Badge color={CONTRACT_STATUS_COLOR[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>} />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
              <div><dt className="text-gray-500">المستأجر</dt><dd className="mt-1"><Link href={`/tenants/${c.tenant.id}`} className="text-brand-700 hover:underline">{c.tenant.name}</Link></dd></div>
              <div><dt className="text-gray-500">الفترة</dt><dd className="tabular mt-1">{formatDate(c.startDate)} — {formatDate(c.endDate)}</dd></div>
              <div><dt className="text-gray-500">المدة / الدفع</dt><dd className="mt-1">{c.durationMonths} شهرًا · {BILLING_CYCLE_LABELS[c.billingCycle]}</dd></div>
              <div><dt className="text-gray-500">قبل الخصم</dt><dd className="tabular mt-1">{formatSAR(c.rentAmount)}</dd></div>
              <div><dt className="text-gray-500">الخصم</dt><dd className="tabular mt-1">{formatSAR(c.discountAmount)}</dd></div>
              <div><dt className="text-gray-500">الإجمالي (شامل الضريبة)</dt><dd className="tabular mt-1 font-semibold">{formatSAR(c.totalAmount)}</dd></div>
              <div><dt className="text-gray-500">منها ضريبة القيمة المضافة</dt><dd className="tabular mt-1">{formatSAR(c.vatAmount)}</dd></div>
              <div><dt className="text-gray-500">التأمين</dt><dd className="mt-1">لا يوجد</dd></div>
              {c.previousContract && <div><dt className="text-gray-500">تجديد للعقد</dt><dd className="mt-1"><Link href={`/contracts/${c.previousContract.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{c.previousContract.contractNo}</Link></dd></div>}
              {c.renewedBy && <div><dt className="text-gray-500">جُدد بالعقد</dt><dd className="mt-1"><Link href={`/contracts/${c.renewedBy.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{c.renewedBy.contractNo}</Link> <Badge color={CONTRACT_STATUS_COLOR[c.renewedBy.status]}>{CONTRACT_STATUS_LABELS[c.renewedBy.status]}</Badge></dd></div>}
              {c.terms && <div className="sm:col-span-3"><dt className="text-gray-500">الشروط الخاصة</dt><dd className="mt-1 whitespace-pre-line">{c.terms}</dd></div>}
              {c.notes && <div className="sm:col-span-3"><dt className="text-gray-500">ملاحظات</dt><dd className="mt-1 whitespace-pre-line">{c.notes}</dd></div>}
              <div className="text-xs text-gray-400 sm:col-span-3">
                أنشأه {c.createdById ? userNames[c.createdById] : "النظام (تجديد تلقائي)"} في {formatDateTime(c.createdAt)}
                {c.approvedById && ` · اعتمده ${userNames[c.approvedById]} في ${formatDateTime(c.approvedAt)}`}
              </div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="الوحدات" />
            <Table>
              <thead><tr><Th>الوحدة</Th><Th>النوع</Th><Th>المقاعد</Th><Th>الإيجار الشهري</Th><Th>حتى</Th></tr></thead>
              <tbody>
                {c.units.map((u) => (
                  <tr key={u.id}>
                    <Td><Link href={`/units/${u.unitId}`} className="font-medium text-brand-700 hover:underline">{u.unit.code}</Link>{u.unit.floor && <span className="block text-xs text-gray-400">{u.unit.floor.name}</span>}</Td>
                    <Td>{u.unit.unitType.nameAr}</Td>
                    <Td className="tabular">{u.seats}</Td>
                    <Td className="tabular">{formatSAR(u.price)}</Td>
                    <Td className="tabular">{formatDate(u.endDate)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {showMoney && (
            <Card>
              <CardHeader title="جدول الأقساط" action={c.schedules.length ? <span className="tabular text-sm text-gray-500">المتبقي: {formatSAR(remaining)}</span> : undefined} />
              {c.schedules.length === 0 ? (
                <p className="p-5 text-sm text-gray-500">يُنشأ جدول الأقساط تلقائيًا عند اعتماد العقد.</p>
              ) : (
                <Table>
                  <thead><tr><Th>#</Th><Th>الاستحقاق</Th><Th>الفترة</Th><Th>المبلغ</Th><Th>منها ضريبة</Th><Th>المسدد</Th><Th>الحالة</Th></tr></thead>
                  <tbody>
                    {c.schedules.map((s) => {
                      const st = SCHED[s.status]!;
                      const late = (s.status === "PENDING" || s.status === "PARTIAL") && isOverdue(s.dueDate.toISOString().slice(0, 10));
                      return (
                        <tr key={s.id} className={late ? "bg-red-50/50" : undefined}>
                          <Td className="tabular">{s.seqNo}</Td>
                          <Td className="tabular whitespace-nowrap">{formatDate(s.dueDate)}</Td>
                          <Td className="tabular whitespace-nowrap text-xs text-gray-500">{formatDate(s.periodStart)} — {formatDate(s.periodEnd)}</Td>
                          <Td className="tabular whitespace-nowrap">{formatSAR(s.amountDue)}</Td>
                          <Td className="tabular whitespace-nowrap text-xs text-gray-500">{formatSAR(s.vatAmount)}</Td>
                          <Td className="tabular whitespace-nowrap">{formatSAR(s.amountPaid)}</Td>
                          <Td>
                            <span className="flex flex-wrap gap-1">
                              {(!late || s.status === "PARTIAL") && <Badge color={st.color}>{st.label}</Badge>}
                              {late && <Badge color="red">متأخر</Badge>}
                            </span>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {showMoney && payments.length > 0 && (
            <Card>
              <CardHeader title="الدفعات على هذا العقد" />
              <Table>
                <thead><tr><Th>الإيصال</Th><Th>المبلغ</Th><Th>الوسيلة</Th><Th>تاريخ الدفع</Th><Th>الحالة</Th></tr></thead>
                <tbody>
                  {payments.map((pm) => (
                    <tr key={pm.id} className="hover:bg-gray-50">
                      <Td><Link href={`/finance/payments/${pm.id}`} dir="ltr" className="font-mono text-xs text-brand-700 hover:underline">{pm.receiptNo ?? "بانتظار المراجعة"}</Link></Td>
                      <Td className="tabular whitespace-nowrap">{formatSAR(pm.amount)}</Td>
                      <Td>{PAYMENT_METHOD_LABELS[pm.method]}</Td>
                      <Td className="tabular whitespace-nowrap">{formatDate(pm.paidOn)}</Td>
                      <Td><Badge color={PAYMENT_STATUS_COLOR[pm.status]}>{PAYMENT_STATUS_LABELS[pm.status]}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}

          {p.has("finance.adjust") && openInst.length > 0 && (
            <Card>
              <CardHeader title="تسوية / خصم على قسط" />
              <div className="p-5"><AdjustmentForm action={adjustmentAction.bind(null, id)} installments={openInst} /></div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {actions.length > 0 && (
            <Card>
              <CardHeader title="الإجراءات" />
              <div className="space-y-2 p-5">{actions}</div>
            </Card>
          )}
          <DocumentsPanel actor={actor} owner={{ contractId: id }} path={`/contracts/${id}`} categories={["CONTRACT_SIGNED", "CONTRACT_DRAFT", "OTHER"]} title="نسخة العقد والمرفقات" />
          <Card>
            <CardHeader title="سجل النسخ" />
            {c.versions.length === 0 ? (
              <p className="p-5 text-sm text-gray-500">تُحفظ النسخة الأولى عند الاعتماد.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {c.versions.map((v) => (
                  <li key={v.id} className="px-5 py-2.5">
                    <span className="font-medium">النسخة {v.versionNo}</span> — {v.changeReason}
                    <span className="block text-xs text-gray-400">{v.createdById ? userNames[v.createdById] : "النظام"} · {formatDateTime(v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
