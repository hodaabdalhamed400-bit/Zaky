"use client";
import { useActionState, useMemo, useState } from "react";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

type Inst = { id: string; seqNo: number; dueDate: string; amountDue: string; paid: string; adjusted: string; pending: string; available: string };

const toH = (v: string) => {
  const s = v.replace(/[,،\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
};
const fmt = (h: number) => (h / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function PaymentForm({
  action,
  contractId,
  installments,
  idempotencyKey,
  today,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  contractId: string;
  installments: Inst[];
  idempotencyKey: string;
  today: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const lines = installments
    .map((i) => ({ i, h: toH(alloc[i.id] ?? "") }))
    .filter((x) => (alloc[x.i.id] ?? "") !== "");
  const allocated = lines.reduce((a, x) => a + (x.h ?? 0), 0);
  const invalid = lines.some((x) => x.h === null || x.h <= 0 || x.h > (toH(x.i.available) ?? 0));
  const amountH = toH(amount);
  const match = amountH !== null && amountH > 0 && amountH === allocated && !invalid;
  const payload = useMemo(() => JSON.stringify(lines.filter((x) => x.h).map((x) => ({ scheduleId: x.i.id, amount: (x.h! / 100).toFixed(2) }))), [lines]);

  /** مساعد اختياري: يملأ الأقدم أولًا حتى يغطي المبلغ (يبقى القرار للموظف). */
  const fillOldest = () => {
    let left = amountH ?? 0;
    const next: Record<string, string> = {};
    for (const i of installments) {
      if (left <= 0) break;
      const av = toH(i.available) ?? 0;
      const take = Math.min(av, left);
      if (take > 0) next[i.id] = (take / 100).toFixed(2);
      left -= take;
    }
    setAlloc(next);
  };

  return (
    <form action={formAction} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="contractId" value={contractId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="allocations" value={payload} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="مبلغ الدفعة (ر.س)" htmlFor="amount" required>
          <input id="amount" name="amount" inputMode="decimal" dir="ltr" required value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass + " tabular text-start"} />
        </Field>
        <Field label="تاريخ الدفع" htmlFor="paidOn" required>
          <input id="paidOn" name="paidOn" type="date" required max={today} defaultValue={today} className={inputClass + " tabular"} />
        </Field>
        <Field label="وسيلة الدفع" htmlFor="method" required>
          <select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="BANK_TRANSFER">تحويل بنكي</option>
            <option value="CARD">شبكة / مدى</option>
            <option value="CASH">نقد</option>
            <option value="CHEQUE">شيك</option>
            <option value="OTHER">أخرى</option>
          </select>
        </Field>
        <Field label="رقم المرجع" htmlFor="referenceNo" required={method === "BANK_TRANSFER" || method === "CHEQUE"} hint="رقم الحوالة أو العملية — يمنع تكرار تسجيلها">
          <input id="referenceNo" name="referenceNo" dir="ltr" maxLength={80} required={method === "BANK_TRANSFER" || method === "CHEQUE"} className={inputClass + " text-start"} />
        </Field>
      </div>

      <fieldset className="rounded-xl border border-gray-200">
        <legend className="mx-4 px-1 text-sm font-semibold text-gray-800">توزيع الدفعة على الأقساط</legend>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2">
          <p className="text-xs text-gray-500">اختر الأقساط وأدخل المبلغ لكل منها. لا يوجد دفع زائد: يجب أن يساوي مجموع التوزيع مبلغ الدفعة.</p>
          <button type="button" onClick={fillOldest} disabled={!amountH} className={buttonClass("secondary", "text-xs")}>توزيع على الأقدم أولًا</button>
        </div>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[560px] text-sm">
            <thead><tr className="bg-gray-50 text-xs text-gray-600"><th className="px-4 py-2 text-start">#</th><th className="px-4 py-2 text-start">الاستحقاق</th><th className="px-4 py-2 text-start">القسط</th><th className="px-4 py-2 text-start">المتاح للسداد</th><th className="px-4 py-2 text-start">المبلغ المخصص</th></tr></thead>
            <tbody>
              {installments.map((i) => {
                const v = alloc[i.id] ?? "";
                const h = v ? toH(v) : 0;
                const bad = v !== "" && (h === null || h <= 0 || h > (toH(i.available) ?? 0));
                const late = i.dueDate < today;
                return (
                  <tr key={i.id} className="border-t border-gray-100">
                    <td className="tabular px-4 py-2">{i.seqNo}</td>
                    <td className="tabular px-4 py-2">{i.dueDate}{late && <span className="ms-1.5 rounded bg-red-50 px-1.5 text-xs text-red-700">متأخر</span>}</td>
                    <td className="tabular px-4 py-2">{i.amountDue}</td>
                    <td className="tabular px-4 py-2">
                      {i.available}
                      {Number(i.pending) > 0 && <span className="block text-xs text-amber-700">{i.pending} بانتظار المراجعة</span>}
                    </td>
                    <td className="px-4 py-2">
                      <label className="sr-only" htmlFor={`a-${i.id}`}>المبلغ للقسط {i.seqNo}</label>
                      <input id={`a-${i.id}`} inputMode="decimal" dir="ltr" value={v} disabled={Number(i.available) <= 0} onChange={(e) => setAlloc((a) => ({ ...a, [i.id]: e.target.value }))} className={inputClass + " tabular w-32 text-start" + (bad ? " border-red-400" : "")} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={"flex justify-between rounded-b-xl px-4 py-3 text-sm " + (match ? "bg-emerald-50 text-emerald-800" : "bg-gray-50 text-gray-700")} aria-live="polite">
          <span>مجموع التوزيع: <span className="tabular font-semibold">{fmt(allocated)}</span> ر.س</span>
          <span>{amountH === null ? "أدخل مبلغ الدفعة" : match ? "مطابق ✓" : invalid ? "مبلغ قسط غير صحيح أو يتجاوز المتاح" : `الفرق: ${fmt((amountH ?? 0) - allocated)} ر.س`}</span>
        </div>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="إثبات الدفع (اختياري)" htmlFor="proof" hint="صورة الحوالة أو الإيصال — PDF أو صورة حتى 10 ميجابايت">
          <input id="proof" name="proof" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-900" />
        </Field>
        <Field label="ملاحظات" htmlFor="notes">
          <input id="notes" name="notes" maxLength={1000} className={inputClass} />
        </Field>
      </div>
      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-gray-500">تُسجَّل الدفعة بانتظار المراجعة، ولا تُحتسب ولا يصدر لها إيصال قبل اعتمادها.</p>
        <SubmitButton>تسجيل الدفعة</SubmitButton>
      </div>
    </form>
  );
}

export function AdjustmentForm({ action, installments }: { action: (p: FormState, fd: FormData) => Promise<FormState>; installments: { id: string; seqNo: number; dueDate: string; remaining: string }[] }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="القسط" htmlFor="adj-s" required>
          <select id="adj-s" name="scheduleId" required className={inputClass} defaultValue="">
            <option value="" disabled>اختر</option>
            {installments.map((i) => <option key={i.id} value={i.id}>#{i.seqNo} — {i.dueDate} (متبقٍ {i.remaining})</option>)}
          </select>
        </Field>
        <Field label="النوع" htmlFor="adj-t" required>
          <select id="adj-t" name="type" className={inputClass} defaultValue="DISCOUNT">
            <option value="DISCOUNT">خصم</option>
            <option value="WRITE_OFF">إعفاء</option>
            <option value="CORRECTION">تصحيح</option>
          </select>
        </Field>
        <Field label="المبلغ (ر.س)" htmlFor="adj-a" required>
          <input id="adj-a" name="amount" inputMode="decimal" dir="ltr" required className={inputClass + " tabular text-start"} />
        </Field>
      </div>
      <Field label="السبب" htmlFor="adj-r" required hint="التسوية تخفض المستحق، ولا تُعدّل ولا تُحذف بعد تسجيلها. لا توجد رسوم تأخير.">
        <input id="adj-r" name="reason" required minLength={5} maxLength={1000} className={inputClass} />
      </Field>
      <div className="flex justify-end"><SubmitButton variant="secondary">تسجيل التسوية</SubmitButton></div>
    </form>
  );
}
