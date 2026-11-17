"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction, type LoginState } from "./actions";
import { EmailField, PasswordField } from "./fields";

export function AuthSubmit({ label, pending }: { label: string; pending: string }) {
  return (
    <div className="group/btn relative overflow-hidden rounded-xl pt-1">
      <SubmitButton pendingText={pending} className="relative h-11 w-full overflow-hidden rounded-xl text-[0.95rem] transition-transform hover:-translate-y-0.5">
        <span className="relative z-10 inline-flex items-center gap-2">
          {label}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 transition-transform duration-300 group-hover/btn:-translate-x-1" aria-hidden="true">
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
        </span>
        <span className="pointer-events-none absolute inset-y-0 start-0 w-1/3 bg-gradient-to-l from-transparent via-white/25 to-transparent opacity-0 group-hover/btn:animate-[sweep_0.9s_ease-out] group-hover/btn:opacity-100" aria-hidden="true" />
      </SubmitButton>
    </div>
  );
}

export function LoginForm({ notice }: { notice?: string }) {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="auth-field space-y-4" noValidate>
      {state.error ? (
        <div className="animate-[scale-in_0.35s_ease-out,shake_0.4s_ease-in-out]"><Alert>{state.error}</Alert></div>
      ) : notice ? (
        <Alert kind="success">{notice}</Alert>
      ) : (
        <span hidden />
      )}

      <EmailField defaultValue={state.email} />

      <PasswordField
        id="password"
        label="كلمة المرور"
        autoComplete="current-password"
        aside={<Link href="/login/forgot" className="text-xs font-medium text-accent-700 hover:text-accent-600 hover:underline">نسيت كلمة المرور؟</Link>}
      />

      <label className="flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" name="remember" value="1" className="size-4 rounded border-gray-300 accent-accent-600" />
        تذكّرني على هذا الجهاز
      </label>

      <AuthSubmit label="تسجيل الدخول" pending="جارٍ التحقق…" />
    </form>
  );
}
