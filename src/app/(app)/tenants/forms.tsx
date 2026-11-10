"use client";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { useRef } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { FormState } from "@/lib/auth/server";
import type { TenantFormState } from "./actions";

type Initial = {
  type: string; name: string; contactPersonName: string | null; mobile: string | null; email: string | null; crNumber: string | null;
  nationalId: string | null; vatNumber: string | null; nationalAddress: string | null; primaryBranchId: string | null; status: string; notes: string | null;
};

export function TenantForm({
  action,
  branches,
  initial,
  canSensitive,
  nationalIdHidden,
}: {
  action: (p: TenantFormState, fd: FormData) => Promise<TenantFormState>;
  branches: { id: string; nameAr: string }[];
  initial?: Initial;
  canSensitive: boolean;
  nationalIdHidden?: boolean;
}) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-6">
      {state.error && <Alert kind={state.duplicateSuspect ? "warning" : "error"}>{state.error}</Alert>}
      {state.duplicateSuspect && (
        <label className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
          <input type="checkbox" name="confirmDuplicate" className="size-4 accent-brand-700" />
          تحققت من أنه عميل مختلف، أكّد الحفظ
        </label>
      )}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="نوع العميل" htmlFor="type" required>
          <select id="type" name="type" defaultValue={initial?.type ?? "COMPANY"} className={inputClass}>
            <option value="COMPANY">منشأة</option>
            <option value="INDIVIDUAL">فرد</option>
          </select>
        </Field>
        <div className="lg:col-span-2">
          <Field label="اسم العميل أو المنشأة" htmlFor="name" required>
            <input id="name" name="name" required maxLength={200} defaultValue={initial?.name} className={inputClass} />
          </Field>
        </div>
        <Field label="الفرع المرتبط" htmlFor="primaryBranchId" required>
          <select id="primaryBranchId" name="primaryBranchId" required defaultValue={initial?.primaryBranchId ?? (branches.length === 1 ? branches[0]!.id : "")} className={inputClass}>
            <option value="" disabled>اختر الفرع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
        </Field>
        <Field label="الحالة" htmlFor="status" hint="تتحدث تلقائيًا مع العقود">
          <select id="status" name="status" defaultValue={initial?.status ?? "PROSPECT"} className={inputClass}>
            <option value="PROSPECT">محتمل</option>
            <option value="ACTIVE">نشط</option>
            <option value="FORMER">سابق</option>
          </select>
        </Field>
        <Field label="الشخص المسؤول" htmlFor="contactPersonName">
          <input id="contactPersonName" name="contactPersonName" maxLength={120} defaultValue={initial?.contactPersonName ?? ""} className={inputClass} />
        </Field>
        <Field label="رقم الجوال" htmlFor="mobile">
          <input id="mobile" name="mobile" dir="ltr" inputMode="tel" maxLength={20} defaultValue={initial?.mobile ?? ""} className={inputClass + " text-start"} placeholder="05XXXXXXXX" />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email">
          <input id="email" name="email" type="email" dir="ltr" maxLength={200} defaultValue={initial?.email ?? ""} className={inputClass + " text-start"} />
        </Field>
        <Field label="رقم السجل التجاري" htmlFor="crNumber" hint="10 أرقام">
          <input id="crNumber" name="crNumber" dir="ltr" inputMode="numeric" maxLength={10} defaultValue={initial?.crNumber ?? ""} className={inputClass + " tabular text-start"} />
        </Field>
        <Field label="الرقم الضريبي" htmlFor="vatNumber" hint="15 رقمًا، عند انطباقه">
          <input id="vatNumber" name="vatNumber" dir="ltr" inputMode="numeric" maxLength={15} defaultValue={initial?.vatNumber ?? ""} className={inputClass + " tabular text-start"} />
        </Field>
        {canSensitive ? (
          <Field label="رقم الهوية" htmlFor="nationalId" hint="بيانات حساسة: يراها المخولون فقط">
            <input id="nationalId" name="nationalId" dir="ltr" inputMode="numeric" maxLength={10} autoComplete="off" defaultValue={initial?.nationalId ?? ""} className={inputClass + " tabular text-start"} />
          </Field>
        ) : (
          <Field label="رقم الهوية" htmlFor="nationalId-hidden">
            <input id="nationalId-hidden" disabled value={nationalIdHidden ? "محجوب — مسجل" : "يُدخله مستخدم مخول"} className={inputClass} />
          </Field>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="العنوان الوطني" htmlFor="nationalAddress">
            <input id="nationalAddress" name="nationalAddress" maxLength={300} defaultValue={initial?.nationalAddress ?? ""} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="ملاحظات" htmlFor="notes">
            <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ""} className={inputClass} />
          </Field>
        </div>
      </div>
      <div className="flex justify-end"><SubmitButton>حفظ</SubmitButton></div>
    </ActionForm>
  );
}

export function ContactForm({ action }: { action: (p: FormState, fd: FormData) => Promise<FormState> }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionForm(async (p: FormState, fd: FormData) => {
    const r = await action(p, fd);
    if (r.success) ref.current?.reset();
    return r;
  }, {});
  return (
    <ActionForm ref={ref} onSubmit={formAction} pending={pending} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم" htmlFor="c-name" required><input id="c-name" name="name" required maxLength={120} className={inputClass} /></Field>
        <Field label="الصفة" htmlFor="c-title"><input id="c-title" name="title" maxLength={80} className={inputClass} placeholder="مدير مالي…" /></Field>
        <Field label="الجوال" htmlFor="c-mobile"><input id="c-mobile" name="mobile" dir="ltr" inputMode="tel" className={inputClass + " text-start"} /></Field>
        <Field label="البريد" htmlFor="c-email"><input id="c-email" name="email" type="email" dir="ltr" className={inputClass + " text-start"} /></Field>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPrimary" className="size-4 accent-brand-700" /> جهة الاتصال الأساسية</label>
        <SubmitButton variant="secondary" pendingText="…">إضافة</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function InteractionForm({ action }: { action: (p: FormState, fd: FormData) => Promise<FormState> }) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionForm(async (p: FormState, fd: FormData) => {
    const r = await action(p, fd);
    if (r.success) ref.current?.reset();
    return r;
  }, {});
  return (
    <ActionForm ref={ref} onSubmit={formAction} pending={pending} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="flex gap-2">
        <label htmlFor="i-channel" className="sr-only">الوسيلة</label>
        <select id="i-channel" name="channel" className={inputClass.replace("w-full", "w-32")} defaultValue="CALL">
          <option value="CALL">اتصال</option>
          <option value="VISIT">زيارة</option>
          <option value="WHATSAPP">واتساب</option>
          <option value="EMAIL">بريد</option>
          <option value="NOTE">ملاحظة</option>
        </select>
        <label htmlFor="i-body" className="sr-only">التفاصيل</label>
        <input id="i-body" name="body" required maxLength={3000} placeholder="ماذا تم؟" className={inputClass} />
        <SubmitButton variant="secondary" pendingText="…">تسجيل</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function SmallActionForm({ action, label, confirm, danger }: { action: (p: FormState, fd: FormData) => Promise<FormState>; label: string; confirm: string; danger?: boolean }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-2">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <ConfirmButton message={confirm} variant={danger ? "danger" : "secondary"}>{label}</ConfirmButton>
    </ActionForm>
  );
}

export function RemoveContactButton({ action }: { action: (p: FormState, fd: FormData) => Promise<FormState> }) {
  const [, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="inline">
      <button className="text-xs text-red-600 hover:underline" onClick={(e) => { if (!window.confirm("حذف جهة الاتصال؟")) e.preventDefault(); }}>حذف</button>
    </ActionForm>
  );
}
