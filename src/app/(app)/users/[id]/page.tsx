import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { getUser, listAssignableOptions } from "@/services/users.service";
import { NotFoundError } from "@/lib/errors";
import { formatDateTime } from "@/lib/dates";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { ResetPasswordForm, UserForm } from "../user-form";
import { resetMfaAction, resetPasswordAction, updateUserAction } from "../actions";
import { SmallActionForm } from "../../tenants/forms";

export const metadata: Metadata = { title: "بيانات المستخدم" };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const actor = await requirePageActor("users.view");
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await getUser(prisma, actor, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });

  const isSelf = user.id === actor.id;
  const canManage =
    actor.permissions.has("users.manage") && !(user.role.key === "SUPER_ADMIN" && actor.roleKey !== "SUPER_ADMIN");
  const options = canManage ? await listAssignableOptions(prisma, actor) : null;
  // إذا كان الدور الحالي غير قابل للمنح من قبل المنفذ، لا نعرض نموذج التعديل
  const editable = !!options && (isSelf || options.roles.some((r) => r.id === user.role.id));

  return (
    <>
      <PageHeader title={user.name} description={user.email} />
      {created && <div className="mb-4"><Alert kind="success">تم إنشاء المستخدم بنجاح.</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="البيانات والصلاحيات" />
          <div className="p-5 sm:p-6">
            {editable && options ? (
              <UserForm
                mode="edit"
                action={updateUserAction.bind(null, user.id)}
                roles={options.roles.some((r) => r.id === user.role.id) ? options.roles : [...options.roles, user.role]}
                branches={options.branches}
                isSelf={isSelf}
                initial={{
                  email: user.email,
                  name: user.name,
                  phone: user.phone,
                  roleId: user.role.id,
                  branchIds: user.branchAccess.map((b) => b.branch.id),
                  isActive: user.isActive,
                }}
              />
            ) : (
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-gray-500">الدور</dt><dd className="mt-1 font-medium">{user.role.nameAr}</dd></div>
                <div><dt className="text-gray-500">الحالة</dt><dd className="mt-1">{user.isActive ? <Badge color="green">نشط</Badge> : <Badge color="red">معطل</Badge>}</dd></div>
                <div className="sm:col-span-2"><dt className="text-gray-500">الفروع</dt><dd className="mt-1">{user.role.allBranches ? "جميع الفروع" : user.branchAccess.map((b) => b.branch.nameAr).join("، ") || "—"}</dd></div>
              </dl>
            )}
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="معلومات الحساب" />
            <dl className="space-y-3 p-5 text-sm">
              <div className="flex justify-between gap-2"><dt className="text-gray-500">آخر دخول</dt><dd className="tabular">{formatDateTime(user.lastLoginAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-gray-500">تاريخ الإنشاء</dt><dd className="tabular">{formatDateTime(user.createdAt)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-gray-500">التحقق الثنائي</dt><dd>{user.mfaEnabled ? "مفعّل" : "غير مفعّل"}</dd></div>
            </dl>
          </Card>
          {editable && !isSelf && user.mfaEnabled && (
            <Card>
              <CardHeader title="التحقق الثنائي" />
              <div className="space-y-3 p-5">
                <p className="text-sm text-gray-500">استخدمها فقط إذا فقد المستخدم جواله، بعد التحقق من هويته.</p>
                <SmallActionForm action={resetMfaAction.bind(null, user.id)} label="إعادة تعيين التحقق الثنائي" confirm="إعادة تعيين التحقق الثنائي لهذا المستخدم؟ ستُنهى جلساته." danger />
              </div>
            </Card>
          )}
          {editable && !isSelf && (
            <Card>
              <CardHeader title="إعادة تعيين كلمة المرور" />
              <div className="p-5">
                <ResetPasswordForm action={resetPasswordAction.bind(null, user.id)} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
