"use client";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { useRef } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { FileOrCamera } from "@/components/ui/file-or-camera";
import type { FormState } from "@/lib/auth/server";

export function UploadForm({
  action,
  categories,
  canSensitive,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  categories: { value: string; label: string }[];
  canSensitive: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionForm(async (prev: FormState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.success) ref.current?.reset();
    return r;
  }, {});
  return (
    <ActionForm ref={ref} onSubmit={formAction} pending={pending} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نوع المستند" htmlFor="doc-category" required>
          <select id="doc-category" name="category" required className={inputClass} defaultValue="">
            <option value="" disabled>اختر</option>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </Field>
        <Field label="الملف" htmlFor="doc-file" required hint="صوّر بالكاميرا أو اختر PDF/صورة، حتى 10 ميجابايت">
          <FileOrCamera id="doc-file" />
        </Field>
      </div>
      {canSensitive && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" name="isSensitive" className="size-4 accent-brand-700" />
          مستند حساس (يظهر فقط للمخولين بالبيانات الحساسة)
        </label>
      )}
      <SubmitButton variant="secondary" pendingText="جارٍ الرفع…">رفع المستند</SubmitButton>
    </ActionForm>
  );
}

export function DeleteDocButton({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="inline">
      {state.error && <span role="alert" className="me-2 text-xs text-red-600">{state.error}</span>}
      <button type="submit" className="text-xs text-red-600 hover:underline" onClick={(e) => { if (!window.confirm("حذف المستند؟ يبقى محفوظًا في سجل التدقيق.")) e.preventDefault(); }}>
        حذف
      </button>
    </ActionForm>
  );
}
