import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { mfaEnforced, mfaRequiredRoles } from "@/services/mfa.service";
import { Alert, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Enroll } from "./enroll";

export const metadata: Metadata = { title: "التحقق الثنائي" };

export default async function AccountMfaPage({ searchParams }: { searchParams: Promise<{ required?: string; recoveryUsed?: string }> }) {
  const actor = await requirePageActor(undefined, { allowMfaSetup: true });
  const { required, recoveryUsed } = await searchParams;
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { mfaEnabled: true, mfaRecoveryHashes: true } });
  const roleRequires = (await mfaRequiredRoles(prisma)).includes(String(actor.roleKey));
  return (
    <>
      <PageHeader title="التحقق الثنائي" description="طبقة حماية إضافية: رمز متغير من جوالك مع كلمة المرور." />
      {required && <div className="mb-4"><Alert kind="warning">دورك ({actor.roleNameAr}) يتطلب تفعيل التحقق الثنائي قبل استخدام النظام.</Alert></div>}
      {recoveryUsed !== undefined && <div className="mb-4"><Alert kind="warning">دخلت برمز استرداد. تبقى لديك {recoveryUsed} رموز. إذا فقدت جوالك اطلب من مسؤول النظام إعادة تعيين التحقق الثنائي.</Alert></div>}
      <Card className="max-w-xl">
        <CardHeader title={u.mfaEnabled ? "الحالة: مفعّل" : "الحالة: غير مفعّل"} />
        <div className="p-5">
          {u.mfaEnabled ? (
            <div className="space-y-2 text-sm text-gray-700">
              <p>التحقق الثنائي مفعّل على حسابك. رموز الاسترداد المتبقية: {u.mfaRecoveryHashes.length}.</p>
              <p className="text-gray-500">لإعادة التعيين (مثل تغيير الجوال) تواصل مع مسؤول النظام؛ يتم ذلك من صفحة المستخدم ويُسجَّل في سجل التدقيق.</p>
            </div>
          ) : (
            <>
              {roleRequires && mfaEnforced() && !required && <div className="mb-4"><Alert kind="info">هذا مطلوب لدورك.</Alert></div>}
              <Enroll />
            </>
          )}
        </div>
      </Card>
    </>
  );
}
