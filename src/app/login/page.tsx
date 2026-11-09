import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage() {
  if (await getActor()) redirect("/");
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={240} height={92} className="mb-8 h-20 w-auto" />
            <h1 className="text-2xl font-bold text-gray-900">تسجيل الدخول</h1>
            <p className="mt-1 text-sm text-gray-500">ZAKI Smart ERP — نظام إدارة الفروع والعقود والتحصيل</p>
          </div>
          <LoginForm />
          <p className="mt-8 text-xs leading-relaxed text-gray-400">
            هذا نظام داخلي لشركة ذكي لحاضنات ومسرعات الأعمال. الدخول مقتصر على الموظفين المصرح لهم، وتُسجَّل جميع العمليات.
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-brand-900 lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_20%,rgba(30,173,192,0.28),transparent_55%)]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/zaki-mark-white.svg" alt="" aria-hidden="true" className="absolute -end-16 top-16 h-80 w-auto opacity-10" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="text-3xl font-bold leading-snug">إدارة مركزية لجميع فروع ذكي</p>
          <div className="mt-5 h-1 w-16 rounded-full bg-accent-500" />
          <p className="mt-4 max-w-md text-brand-100/80">
            الفروع والمكاتب والمستأجرون والعقود والتحصيل في مكان واحد، مع صلاحيات دقيقة لكل مستخدم.
          </p>
        </div>
      </div>
    </div>
  );
}
