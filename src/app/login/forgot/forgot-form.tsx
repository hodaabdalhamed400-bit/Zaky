"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/primitives";
import { forgotAction, type ForgotState } from "../actions";
import { EmailField } from "../fields";
import { AuthSubmit } from "../login-form";

export function ForgotForm() {
  const [state, action] = useActionState<ForgotState, FormData>(forgotAction, {});
  if (state.sent) {
    return (
      <div className="auth-field space-y-5 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-2xl ring-8 ring-emerald-50/50" aria-hidden="true">✉️</div>
        <Alert kind="success">{state.sent}</Alert>
        <Link href="/login" className="inline-block text-sm font-medium text-accent-700 hover:underline">الرجوع لتسجيل الدخول</Link>
      </div>
    );
  }
  return (
    <form action={action} className="auth-field space-y-4" noValidate>
      {state.error ? <div className="animate-[scale-in_0.35s_ease-out,shake_0.4s_ease-in-out]"><Alert>{state.error}</Alert></div> : <span hidden />}
      <EmailField defaultValue={state.email} />
      <AuthSubmit label="أرسل الرابط" pending="جارٍ الإرسال…" />
      <p className="text-center text-sm">
        <Link href="/login" className="font-medium text-accent-700 hover:underline">تذكّرتها؟ ارجع لتسجيل الدخول</Link>
      </p>
    </form>
  );
}
