"use client";
import { useState } from "react";
import { cx, inputClass } from "@/components/ui/primitives";

/** حقول صفحات الدخول المشتركة: أيقونات، حقل البريد، وحقل كلمة مرور بزر إظهار وتحذير Caps Lock. */
export const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);
export const LockIcon = () => (
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

export const fieldInput = "h-11 rounded-xl pl-10 transition-all duration-200 focus:-translate-y-px focus:shadow-[0_8px_20px_-10px_rgb(30_173_192/0.5)]";
const iconBox = "pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-400 transition-colors duration-200 group-focus-within:text-accent-600";

export function EmailField({ defaultValue }: { defaultValue?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="email" className="block text-sm font-medium text-gray-700">البريد الإلكتروني</label>
      <div className="group relative">
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="username"
          required
          defaultValue={defaultValue}
          className={cx(inputClass, fieldInput, "text-start")}
          placeholder="name@company.sa"
        />
        <span className={iconBox}><MailIcon /></span>
      </div>
    </div>
  );
}

export function PasswordField({
  id,
  name = id,
  label,
  autoComplete,
  hint,
  aside,
}: {
  id: string;
  name?: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  aside?: React.ReactNode;
}) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const track = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
        {aside}
      </div>
      <div className="group relative">
        <input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          dir="ltr"
          autoComplete={autoComplete}
          required
          onKeyDown={track}
          onKeyUp={track}
          onBlur={() => setCaps(false)}
          aria-describedby={caps ? `${id}-caps` : hint ? `${id}-hint` : undefined}
          className={cx(inputClass, fieldInput, "pr-11")}
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
      {caps ? (
        <p id={`${id}-caps`} role="status" className="animate-fade-in flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <span aria-hidden="true">⇪</span> زر Caps Lock شغّال
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-gray-500">{hint}</p>
      ) : null}
    </div>
  );
}
