"use client";
import { useActionState, useState } from "react";
import { Alert, Field, buttonClass, inputClass, type ButtonVariant } from "@/components/ui/primitives";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

type A = (p: FormState, fd: FormData) => Promise<FormState>;

export function OpButton({ action, label, confirm, variant = "primary" }: { action: A; label: string; confirm: string; variant?: ButtonVariant }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      <ConfirmButton message={confirm} variant={variant} className="w-full">{label}</ConfirmButton>
    </form>
  );
}

/** إجراء يتطلب سببًا مكتوبًا (إرجاع، إلغاء). */
export function ReasonOp({ action, label, placeholder, variant = "secondary" }: { action: A; label: string; placeholder: string; variant?: ButtonVariant }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, "w-full")}>{label}</button>;
  return (
    <form action={formAction} className="space-y-2 rounded-lg border border-gray-200 p-3">
      {state.error && <Alert>{state.error}</Alert>}
      <label className="sr-only" htmlFor={`r-${label}`}>السبب</label>
      <textarea id={`r-${label}`} name="reason" required minLength={3} rows={2} placeholder={placeholder} className={inputClass} />
      <div className="flex gap-2">
        <SubmitButton variant={variant} className="flex-1">{label}</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost")}>تراجع</button>
      </div>
    </form>
  );
}

export function TerminateForm({ action, minDate, maxDate }: { action: A; minDate: string; maxDate: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={buttonClass("danger", "w-full")}>إنهاء مبكر</button>;
  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-red-200 bg-red-50/40 p-3">
      {state.error && <Alert>{state.error}</Alert>}
      <p className="text-xs text-gray-600">لا يُسترد أي مبلغ مدفوع عند الخروج المبكر. حدد مصير الأقساط القادمة حسب الاتفاق مع الشركة.</p>
      <Field label="تاريخ الخروج" htmlFor="exitDate" required>
        <input id="exitDate" name="exitDate" type="date" required min={minDate} max={maxDate} className={inputClass + " tabular"} />
      </Field>
      <fieldset className="space-y-1.5 text-sm">
        <legend className="mb-1 font-medium text-gray-700">الأقساط القادمة غير المدفوعة <span className="text-red-600">*</span></legend>
        <label className="flex items-start gap-2"><input type="radio" name="policy" value="KEEP_DUE" required className="mt-1 accent-brand-700" /> تبقى مستحقة على العميل (كامل قيمة العقد)</label>
        <label className="flex items-start gap-2"><input type="radio" name="policy" value="CANCEL_FUTURE" className="mt-1 accent-brand-700" /> تُلغى الأقساط التي تبدأ بعد تاريخ الخروج</label>
      </fieldset>
      <Field label="السبب وتفاصيل الاتفاق" htmlFor="term-reason" required>
        <textarea id="term-reason" name="reason" required minLength={3} rows={2} className={inputClass} />
      </Field>
      <div className="flex gap-2">
        <ConfirmButton message="تأكيد إنهاء العقد؟ لا يمكن التراجع." variant="danger" className="flex-1">تأكيد الإنهاء</ConfirmButton>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost")}>تراجع</button>
      </div>
    </form>
  );
}
