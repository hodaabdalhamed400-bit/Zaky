import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/server";
import { AuthShell } from "../auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "نسيت كلمة المرور" };

export default async function ForgotPage() {
  if (await getActor()) redirect("/");
  return (
    <AuthShell title="نسيت كلمة المرور؟" subtitle="ولا يهمك، اكتب بريدك المسجّل ونرسل لك رابط تعيّن فيه كلمة مرور جديدة.">
      <ForgotForm />
    </AuthShell>
  );
}
