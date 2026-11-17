import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Alert } from "@/components/ui/primitives";
import { checkResetToken } from "@/services/password-reset.service";
import { AuthShell } from "../auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "تعيين كلمة مرور جديدة", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = String((await searchParams).token ?? "");
  const check = await checkResetToken(prisma, token);
  if (!check.valid) {
    return (
      <AuthShell title="الرابط غير صالح" subtitle="يمكن انتهت صلاحيته (30 دقيقة) أو استُخدم قبل.">
        <div className="auth-field space-y-4 text-center">
          <Alert kind="warning">اطلب رابط جديد وبيوصلك على بريدك.</Alert>
          <Link href="/login/forgot" className="inline-block text-sm font-medium text-accent-700 hover:underline">اطلب رابط جديد</Link>
        </div>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="كلمة مرور جديدة" subtitle={`للحساب ${check.email}`}>
      <ResetForm token={token} />
    </AuthShell>
  );
}
