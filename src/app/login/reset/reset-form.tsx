"use client";
import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/primitives";
import { resetAction, type ResetState } from "../actions";
import { PasswordField } from "../fields";
import { AuthSubmit } from "../login-form";

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState<ResetState, FormData>(resetAction, {});
  return (
    <form action={action} className="auth-field space-y-4" noValidate>
      {state.error ? (
        <div className="animate-[scale-in_0.35s_ease-out,shake_0.4s_ease-in-out]">
          <Alert>
            {state.error}
            {state.expired && <> <Link href="/login/forgot" className="font-bold underline">اطلب رابط جديد</Link></>}
          </Alert>
        </div>
      ) : (
        <span hidden />
      )}
      <input type="hidden" name="token" value={token} />
      <PasswordField id="newPassword" label="كلمة المرور الجديدة" autoComplete="new-password" hint="10 أحرف على الأقل، فيها حروف وأرقام." />
      <PasswordField id="confirmPassword" label="تأكيد كلمة المرور" autoComplete="new-password" />
      <AuthSubmit label="احفظ كلمة المرور" pending="جارٍ الحفظ…" />
    </form>
  );
}
