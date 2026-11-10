import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor, getMfaCookie } from "@/lib/auth/server";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "التحقق الثنائي" };

export default async function MfaPage() {
  if (await getActor()) redirect("/");
  if (!(await getMfaCookie())) redirect("/login");
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={200} height={76} className="mb-8 h-16 w-auto" />
        <h1 className="text-2xl font-bold text-gray-900">التحقق الثنائي</h1>
        <p className="mt-1 mb-6 text-sm text-gray-500">أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة، أو أحد رموز الاسترداد.</p>
        <MfaForm />
      </div>
    </div>
  );
}
