"use client";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import type { Branch } from "@prisma/client";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

export function BranchForm({
  action,
  initial,
  codeLocked,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  initial?: Pick<Branch, "code" | "nameAr" | "city" | "address" | "mapUrl" | "managerName" | "managerActing" | "contactPerson" | "phone" | "notes" | "status">;
  codeLocked?: boolean;
}) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="اسم الفرع" htmlFor="nameAr" required>
          <input id="nameAr" name="nameAr" required maxLength={100} defaultValue={initial?.nameAr} className={inputClass} />
        </Field>
        <Field label="رمز الفرع" htmlFor="code" required hint={codeLocked ? "لا يمكن تغييره: للفرع عقود مسجلة" : "2–6 أحرف إنجليزية/أرقام، يُستخدم في ترقيم العقود"}>
          <input
            id="code"
            name="code"
            required
            dir="ltr"
            maxLength={6}
            readOnly={codeLocked}
            defaultValue={initial?.code}
            className={inputClass + " font-mono uppercase" + (codeLocked ? " bg-gray-100" : "")}
          />
        </Field>
        <Field label="الحالة" htmlFor="status" required hint="الفرع الموقوف تُسحب صلاحيات موظفيه عليه وتبقى بياناته">
          <select id="status" name="status" defaultValue={initial?.status ?? "PREPARING"} className={inputClass}>
            <option value="ACTIVE">عامل</option>
            <option value="PREPARING">قيد التجهيز</option>
            <option value="INACTIVE">موقوف</option>
          </select>
        </Field>
        <Field label="المدينة" htmlFor="city">
          <input id="city" name="city" maxLength={80} defaultValue={initial?.city ?? ""} className={inputClass} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="العنوان" htmlFor="address">
            <input id="address" name="address" maxLength={300} defaultValue={initial?.address ?? ""} className={inputClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="رابط الموقع على الخريطة" htmlFor="mapUrl" hint="رابط Google Maps يبدأ بـ https://">
            <input id="mapUrl" name="mapUrl" type="url" dir="ltr" maxLength={1000} defaultValue={initial?.mapUrl ?? ""} className={inputClass + " text-start"} placeholder="https://maps.app.goo.gl/…" />
          </Field>
        </div>
        <Field label="مدير الفرع" htmlFor="managerName">
          <input id="managerName" name="managerName" maxLength={120} defaultValue={initial?.managerName ?? ""} className={inputClass} />
          <label className="mt-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="managerActing" defaultChecked={initial?.managerActing} className="size-4 rounded border-gray-300 accent-brand-700" />
            مكلف مؤقتًا
          </label>
        </Field>
        <Field label="المسؤول / جهة التواصل" htmlFor="contactPerson">
          <input id="contactPerson" name="contactPerson" maxLength={120} defaultValue={initial?.contactPerson ?? ""} className={inputClass} />
        </Field>
        <Field label="رقم التواصل" htmlFor="phone">
          <input id="phone" name="phone" dir="ltr" inputMode="tel" maxLength={20} defaultValue={initial?.phone ?? "0500510051"} className={inputClass + " text-start"} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات" htmlFor="notes">
            <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ""} className={inputClass} />
          </Field>
        </div>
      </div>
      <div className="flex justify-end">
        <SubmitButton>حفظ</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function FloorForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-36 flex-1">
          <Field label="اسم الدور" htmlFor="floor-name">
            <input id="floor-name" name="name" required maxLength={60} placeholder="مثال: الدور الأول" className={inputClass} />
          </Field>
        </div>
        <div className="w-24">
          <Field label="الترتيب" htmlFor="floor-level">
            <input id="floor-level" name="level" type="number" min={-5} max={200} defaultValue={0} className={inputClass + " tabular"} />
          </Field>
        </div>
        <SubmitButton variant="secondary" pendingText="…">إضافة</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DeleteFloorForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="inline">
      {state.error && <span role="alert" className="me-2 text-xs text-red-600">{state.error}</span>}
      <button
        type="submit"
        className="text-xs text-red-600 hover:underline"
        onClick={(e) => {
          if (!window.confirm("حذف هذا الدور؟")) e.preventDefault();
        }}
      >
        حذف
      </button>
    </ActionForm>
  );
}
