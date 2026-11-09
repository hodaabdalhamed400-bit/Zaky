"use client";
import { useActionState } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

export function TypeForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <Field label="اسم النوع" htmlFor="type-name" required>
        <input id="type-name" name="nameAr" required maxLength={60} className={inputClass} placeholder="مثال: مكتب افتراضي" />
      </Field>
      <Field label="طريقة الإشغال" htmlFor="type-mode" required hint="المشتركة تُؤجر بالمقاعد حتى سعة الوحدة">
        <select id="type-mode" name="occupancyMode" className={inputClass} defaultValue="EXCLUSIVE">
          <option value="EXCLUSIVE">حصرية (عقد واحد في الفترة)</option>
          <option value="SHARED">مشتركة (بالمقاعد)</option>
        </select>
      </Field>
      <Field label="طريقة التأجير" htmlFor="type-lease" required hint="الحجوزات لا تدخل في العقود ولا في نسب إشغال العقود">
        <select id="type-lease" name="leaseMode" className={inputClass} defaultValue="LEASE">
          <option value="LEASE">بعقود</option>
          <option value="BOOKING">حجوزات بالساعة/اليوم</option>
        </select>
      </Field>
      <SubmitButton className="w-full">إضافة النوع</SubmitButton>
    </form>
  );
}

export function ToggleTypeForm({ action, active }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; active: boolean }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction}>
      {state.error && <span role="alert" className="text-xs text-red-600">{state.error}</span>}
      <button type="submit" className="text-xs text-brand-700 hover:underline">{active ? "تعطيل" : "تفعيل"}</button>
    </form>
  );
}
