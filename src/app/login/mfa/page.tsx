import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor, getMfaCookie } from "@/lib/auth/server";
import { AuthShell } from "../auth-shell";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "التحقق الثنائي" };

export default async function MfaPage() {
  if (await getActor()) redirect("/");
  if (!(await getMfaCookie())) redirect("/login");
  return (
    <AuthShell title="التحقق الثنائي" subtitle="أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد.">
      <MfaForm />
    </AuthShell>
  );
}
