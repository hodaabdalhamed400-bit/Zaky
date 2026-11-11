import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { PAYMENT_METHOD_LABELS } from "@/services/payments.service";
import {
  PURCHASE_PAYMENT_COLOR,
  PURCHASE_PAYMENT_LABELS,
  PURCHASE_STATUS_COLOR,
  PURCHASE_STATUS_LABELS,
  getPurchase,
} from "@/services/purchases.service";
import { Alert, Badge, Card, CardHeader, LinkButton, PageHeader } from "@/components/ui/primitives";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { OpButton, ReasonOp } from "../../contracts/op-forms";
import { MarkPaidForm } from "../purchase-form";
import { purchaseOpAction } from "../actions";

export const metadata: Metadata = { title: "فاتورة شراء" };
const DONE: Record<string, string> = {
  created: "تم حفظ الفاتورة وإرسالها للمحاسب للمراجعة.",
  updated: "تم حفظ التعديلات وإعادة الفاتورة للمراجعة.",
  approve: "تم اعتماد الفاتورة.",
  reject: "أُرجعت الفاتورة للتعديل.",
  paid: "تم تسجيل الفاتورة كمدفوعة للمورد.",
  unpaid: "أُلغي تسجيل الدفع.",
};

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string; uploadError?: string }> }) {
  const actor = await requirePageActor("purchases.view");
  const { id } = await params;
  const { done, uploadError } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { invoice: p, userNames } = await getPurchase(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  const can = (x: Parameters<typeof actor.permissions.has>[0]) => actor.permissions.has(x);
  const op = (o: "approve" | "reject" | "paid" | "unpaid") => purchaseOpAction.bind(null, id, o);
  const who = (uid: string | null, at: Date | null) => (uid ? `${userNames[uid] ?? "—"} · ${formatDateTime(at)}` : "—");
  const editable = p.status !== "APPROVED" && can("purchases.create");

  return (
    <>
      <PageHeader
        title={`فاتورة شراء ${p.refNo}`}
        description={`${p.supplierName} · ${p.branch.nameAr}`}
        actions={editable ? <LinkButton href={`/purchases/${id}/edit`} variant="secondary">تعديل</LinkButton> : undefined}
      />
      {done && DONE[done] && <div className="mb-4"><Alert kind="success">{DONE[done]}</Alert></div>}
      {uploadError && <div className="mb-4"><Alert kind="warning">حُفظت الفاتورة، لكن تعذر رفع صورتها: {uploadError}. ارفعها من قسم المرفقات قبل الاعتماد.</Alert></div>}
      {p.status === "REJECTED" && <div className="mb-4"><Alert>أُرجعت للتعديل: {p.rejectionReason}</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="بيانات الفاتورة" action={<Badge color={PURCHASE_STATUS_COLOR[p.status]}>{PURCHASE_STATUS_LABELS[p.status]}</Badge>} />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-3">
              <div><dt className="text-gray-500">الإجمالي شامل الضريبة</dt><dd className="tabular mt-1 text-lg font-bold text-brand-900">{formatSAR(p.totalAmount)}</dd></div>
              <div><dt className="text-gray-500">الضريبة</dt><dd className="tabular mt-1">{formatSAR(p.vatAmount)}</dd></div>
              <div><dt className="text-gray-500">قبل الضريبة</dt><dd className="tabular mt-1">{formatSAR(p.netAmount)}</dd></div>
              <div><dt className="text-gray-500">المورد</dt><dd className="mt-1 font-medium">{p.supplierName}</dd></div>
              <div><dt className="text-gray-500">الرقم الضريبي للمورد</dt><dd dir="ltr" className="tabular mt-1 text-end">{p.supplierVatNo ?? "—"}</dd></div>
              <div><dt className="text-gray-500">رقم فاتورة المورد</dt><dd dir="ltr" className="mt-1 text-end font-mono">{p.invoiceNo}</dd></div>
              <div><dt className="text-gray-500">تاريخ الفاتورة</dt><dd className="tabular mt-1">{formatDate(p.invoiceDate)}</dd></div>
              <div><dt className="text-gray-500">التصنيف</dt><dd className="mt-1">{p.category.nameAr}</dd></div>
              <div><dt className="text-gray-500">الفرع</dt><dd className="mt-1">{p.branch.nameAr}</dd></div>
              {p.description && <div className="sm:col-span-3"><dt className="text-gray-500">الوصف</dt><dd className="mt-1">{p.description}</dd></div>}
              <div className="space-y-0.5 text-xs text-gray-400 sm:col-span-3">
                <p>أضافها: {who(p.createdById, p.createdAt)}</p>
                {p.approvedById && <p>اعتمدها: {who(p.approvedById, p.approvedAt)}</p>}
                {p.rejectedById && <p>أرجعها: {who(p.rejectedById, p.rejectedAt)}</p>}
              </div>
            </dl>
          </Card>
          <DocumentsPanel
            actor={actor}
            owner={{ purchaseInvoiceId: id }}
            path={`/purchases/${id}`}
            categories={["PURCHASE_INVOICE", "PAYMENT_PROOF", "OTHER"]}
            title="صورة الفاتورة والمرفقات"
            canUpload={p.status !== "APPROVED" || can("purchases.approve")}
            canDelete={p.status !== "APPROVED"}
          />
        </div>

        <div className="space-y-6">
          {p.status === "PENDING_REVIEW" && can("purchases.approve") && (
            <Card>
              <CardHeader title="المراجعة" />
              <div className="space-y-2 p-5">
                <p className="mb-2 text-xs text-gray-500">طابق المبالغ ورقم الفاتورة مع الصورة المرفقة قبل الاعتماد. الفاتورة المعتمدة لا تُعدَّل.</p>
                <OpButton action={op("approve")} label="اعتماد الفاتورة" confirm={`اعتماد فاتورة ${p.supplierName} بمبلغ ${formatSAR(p.totalAmount)}؟`} />
                <ReasonOp action={op("reject")} label="إرجاع للتعديل" placeholder="سبب الإرجاع: المبلغ لا يطابق الصورة، الصورة غير واضحة…" variant="danger" />
              </div>
            </Card>
          )}

          {p.status === "APPROVED" && (
            <Card>
              <CardHeader title="الدفع للمورد" action={<Badge color={PURCHASE_PAYMENT_COLOR[p.paymentStatus]}>{PURCHASE_PAYMENT_LABELS[p.paymentStatus]}</Badge>} />
              <div className="space-y-3 p-5 text-sm">
                {p.paymentStatus === "PAID" ? (
                  <>
                    <p>دُفعت {p.paymentMethod ? `(${PAYMENT_METHOD_LABELS[p.paymentMethod]})` : ""} بتاريخ <span className="tabular">{formatDate(p.paidOn)}</span></p>
                    {can("purchases.approve") && <ReasonOp action={op("unpaid")} label="إلغاء تسجيل الدفع" placeholder="سبب الإلغاء: سُجلت بالخطأ…" />}
                  </>
                ) : can("purchases.approve") ? (
                  <MarkPaidForm action={op("paid")} today={todayInRiyadh()} methods={Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }))} />
                ) : (
                  <p className="text-gray-500">لم تُدفع للمورد بعد.</p>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
