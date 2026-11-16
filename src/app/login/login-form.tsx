"use client";
import { useActionState, useState } from "react";
import { Alert, cx, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction, type LoginState } from "./actions";

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const EyeIcon = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="m3 3 18 18" />}
  </svg>
);

const fieldWrap = "group relative";
const iconBox = "pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 transition-colors duration-200 group-focus-within:text-accent-600";

export function LoginForm() {
  const [state, action] = useActionState<LoginState, FormData>(loginAction, {});
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="auth-field space-y-4" noValidate>
      {state.error ? <div className="animate-[scale-in_0.35s_ease-out,shake_0.4s_ease-in-out]"><Alert>{state.error}</Alert></div> : <span hidden />}

      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">البريد الإلكتروني</label>
        <div className={fieldWrap}>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            autoComplete="username"
            required
            defaultValue={state.email}
            className={cx(inputClass, "h-11 rounded-xl pl-10 text-start transition-all duration-200 focus:-translate-y-px focus:shadow-[0_8px_20px_-10px_rgb(30_173_192/0.5)]")}
            placeholder="name@company.sa"
          />
          <span className={iconBox}><MailIcon /></span>
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">كلمة المرور</label>
        <div className={fieldWrap}>
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            dir="ltr"
            autoComplete="current-password"
            required
            className={cx(inputClass, "h-11 rounded-xl pl-10 pr-11 transition-all duration-200 focus:-translate-y-px focus:shadow-[0_8px_20px_-10px_rgb(30_173_192/0.5)]")}
          />
          <span className={iconBox}><LockIcon /></span>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            aria-pressed={show}
            className="absolute inset-y-0 right-1.5 my-auto grid size-8 place-items-center rounded-lg text-gray-400 transition-all hover:bg-accent-50 hover:text-accent-700 active:scale-90"
          >
            <EyeIcon off={show} />
          </button>
        </div>
      </div>

      <div className="group/btn relative overflow-hidden rounded-xl pt-1">
        <SubmitButton pendingText="جارٍ التحقق…" className="relative h-11 w-full overflow-hidden rounded-xl text-[0.95rem] transition-transform hover:-translate-y-0.5">
          <span className="relative z-10 inline-flex items-center gap-2">
            تسجيل الدخول
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4 transition-transform duration-300 group-hover/btn:-translate-x-1" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
          </span>
          <span className="pointer-events-none absolute inset-y-0 start-0 w-1/3 bg-gradient-to-l from-transparent via-white/25 to-transparent opacity-0 group-hover/btn:animate-[sweep_0.9s_ease-out] group-hover/btn:opacity-100" aria-hidden="true" />
        </SubmitButton>
      </div>
    </form>
  );
}
