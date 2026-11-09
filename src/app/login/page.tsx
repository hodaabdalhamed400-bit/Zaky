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
            <div className="mb-4 grid size-12 place-items-center rounded-xl bg-brand-700 text-xl font-bold text-white">ذ</div>
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
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.12),transparent_55%)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-white">
          <p className="text-3xl font-bold leading-snug">إدارة مركزية لجميع فروع ذكي</p>
          <p className="mt-3 max-w-md text-brand-100/80">
            الفروع والمكاتب والمستأجرون والعقود والتحصيل في مكان واحد، مع صلاحيات دقيقة لكل مستخدم.
          </p>
        </div>
      </div>
    </div>
  );
}
