"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { mfaAction, type MfaState } from "../actions";

export function MfaForm() {
  const [state, action] = useActionState<MfaState, FormData>(mfaAction, {});
  if (state.restart)
    return (
      <div className="space-y-4">
        <Alert>{state.error}</Alert>
        <Link href="/login" className="text-sm text-brand-700 hover:underline">العودة لتسجيل الدخول</Link>
      </div>
    );
  return (
    <form action={action} className="space-y-5">
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="رمز التحقق" htmlFor="code" required>
        <input id="code" name="code" required dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={11} className={inputClass + " text-center text-lg tracking-[0.4em]"} placeholder="000000" />
      </Field>
      <SubmitButton pendingText="جارٍ التحقق…" className="w-full py-2.5">تحقق</SubmitButton>
      <Link href="/login" className="block text-center text-xs text-gray-500 hover:underline">إلغاء والعودة</Link>
    </form>
  );
}
