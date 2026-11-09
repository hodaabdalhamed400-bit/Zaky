"use client";
import { useActionState } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="البريد الإلكتروني" htmlFor="email" required>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="username"
          required
          defaultValue={state.email}
          className={inputClass + " text-start"}
          placeholder="name@company.sa"
        />
      </Field>
      <Field label="كلمة المرور" htmlFor="password" required>
        <input id="password" name="password" type="password" dir="ltr" autoComplete="current-password" required className={inputClass} />
      </Field>
      <SubmitButton pendingText="جارٍ التحقق…" className="w-full py-2.5">
        تسجيل الدخول
      </SubmitButton>
    </form>
  );
}
