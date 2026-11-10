"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { enrollAction, type EnrollState } from "./actions";

export function Enroll() {
  const [state, action] = useActionState<EnrollState, FormData>(enrollAction, {});
  if (state.codes)
    return (
      <div className="space-y-4">
        <Alert kind="success">تم تفعيل التحقق الثنائي.</Alert>
        <p className="text-sm text-gray-700">احفظ رموز الاسترداد في مكان آمن. كل رمز يُستخدم مرة واحدة عند فقد الجوال، ولن تظهر مرة أخرى.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-4 font-mono text-sm" dir="ltr" data-testid="recovery-codes">
          {state.codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <Link href="/" className={buttonClass("primary")}>متابعة إلى النظام</Link>
      </div>
    );
  if (!state.qrSvg)
    return (
      <form action={action} className="space-y-3">
        <input type="hidden" name="step" value="start" />
        {state.error && <Alert>{state.error}</Alert>}
        <p className="text-sm text-gray-600">ستحتاج تطبيق مصادقة على الجوال مثل Google Authenticator أو Microsoft Authenticator.</p>
        <SubmitButton>بدء التفعيل</SubmitButton>
      </form>
    );
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <ol className="list-decimal space-y-1 ps-5 text-sm text-gray-700">
        <li>افتح تطبيق المصادقة وامسح الرمز التالي.</li>
        <li>أدخل الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.</li>
      </ol>
      {/* SVG مولّد على الخادم من مكتبة QR — لا يحتوي مدخلات مستخدم */}
      <div className="w-48 rounded-lg border border-gray-200 bg-white p-2" aria-label="رمز QR للتفعيل" dangerouslySetInnerHTML={{ __html: state.qrSvg }} />
      <p className="text-xs text-gray-500">لا يمكن المسح؟ أدخل هذا المفتاح يدويًا: <code dir="ltr" className="select-all break-all rounded bg-gray-100 px-1" data-testid="mfa-secret">{state.secret}</code></p>
      <input type="hidden" name="ticket" value={state.ticket ?? ""} />
      <Field label="الرمز من التطبيق" htmlFor="code" required>
        <input id="code" name="code" required dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className={inputClass + " max-w-40 text-center tracking-[0.3em]"} />
      </Field>
      <SubmitButton>تأكيد التفعيل</SubmitButton>
    </form>
  );
}
