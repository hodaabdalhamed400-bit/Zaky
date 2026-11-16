import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/server";
import { AuthShell } from "./auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

/** تحية حسب الوقت بتوقيت الرياض. */
function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Riyadh" }).format(new Date()));
  if (h >= 5 && h < 12) return "صباح الخير";
  if (h >= 12 && h < 17) return "نهارك سعيد";
  return "مساء الخير";
}

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  return (
    <AuthShell greeting={greeting()} title="أهلًا بعودتك" subtitle="سجّل دخولك إلى ZAKI Smart ERP لإدارة الفروع والعقود والتحصيل.">
      <LoginForm />
    </AuthShell>
  );
}
