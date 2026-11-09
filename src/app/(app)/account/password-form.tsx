"use client";
import { useActionState } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { changePasswordAction, type PwState } from "./actions";

export function PasswordForm() {
  const [state, action] = useActionState<PwState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <Field label="كلمة المرور الحالية" htmlFor="currentPassword" required>
        <input id="currentPassword" name="currentPassword" type="password" dir="ltr" autoComplete="current-password" required className={inputClass} />
      </Field>
      <Field label="كلمة المرور الجديدة" htmlFor="newPassword" required hint="10 أحرف على الأقل تتضمن أحرفًا وأرقامًا.">
        <input id="newPassword" name="newPassword" type="password" dir="ltr" autoComplete="new-password" required minLength={10} className={inputClass} />
      </Field>
      <Field label="تأكيد كلمة المرور الجديدة" htmlFor="confirmPassword" required>
        <input id="confirmPassword" name="confirmPassword" type="password" dir="ltr" autoComplete="new-password" required minLength={10} className={inputClass} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton>تغيير كلمة المرور</SubmitButton>
      </div>
    </form>
  );
}
