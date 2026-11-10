import type { Metadata } from "next";
import { requirePageActor } from "@/lib/auth/server";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "حسابي" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const actor = await requirePageActor(undefined, { allowPasswordChange: true });
  await searchParams;
  return (
    <>
      <PageHeader title="حسابي" description={`${actor.email} · ${actor.roleNameAr}`} />
      {actor.mustChangePassword && (
        <div className="mb-4">
          <Alert kind="warning">لديك كلمة مرور مؤقتة. يجب تغييرها قبل استخدام النظام.</Alert>
        </div>
      )}
      <p className="mb-4 text-sm"><a href="/account/mfa" className="text-brand-700 hover:underline">إعدادات التحقق الثنائي ←</a></p>
      <Card className="max-w-xl">
        <CardHeader title="تغيير كلمة المرور" />
        <div className="p-5">
          <PasswordForm />
        </div>
      </Card>
    </>
  );
}
