import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/server";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  return (
    <AuthShell title="تسجيل الدخول" subtitle="ZAKI Smart ERP — نظام إدارة الفروع والعقود والتحصيل">
      <LoginForm />
    </AuthShell>
  );
}
