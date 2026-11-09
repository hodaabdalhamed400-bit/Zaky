import type { Metadata } from "next";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { Card, PageHeader, Alert } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "الأدوار والصلاحيات" };

export default async function RolesPage() {
  await requirePageActor("roles.view");
  const [roles, permissions] = await Promise.all([
    prisma.role.findMany({ orderBy: { createdAt: "asc" }, include: { permissions: { select: { permissionId: true } }, _count: { select: { users: true } } } }),
    prisma.permission.findMany({ orderBy: [{ groupAr: "asc" }, { key: "asc" }] }),
  ]);
  const has = new Map(roles.map((r) => [r.id, new Set(r.permissions.map((p) => p.permissionId))]));

  return (
    <>
      <PageHeader title="الأدوار والصلاحيات" description="مصفوفة الصلاحيات الحالية لكل دور. يتم التحقق منها على الخادم في كل عملية." />
      <div className="mb-4">
        <Alert kind="info">
          توزيع الصلاحيات معتمد من الإدارة (مدير الفرع يعتمد العقود والتحصيل في فرعه). تعديل المصفوفة يتم حاليًا من ملف التعريف{" "}
          <code dir="ltr" className="rounded bg-white/60 px-1">src/lib/rbac/permissions.ts</code> ثم تشغيل{" "}
          <code dir="ltr" className="rounded bg-white/60 px-1">npm run db:seed</code>.
        </Alert>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky start-0 bg-gray-50 px-4 py-3 text-start text-xs font-semibold text-gray-600">الصلاحية</th>
                {roles.map((r) => (
                  <th key={r.id} scope="col" className="bg-gray-50 px-3 py-3 text-center text-xs font-semibold text-gray-700">
                    {r.nameAr}
                    <span className="block font-normal text-gray-400">{r.allBranches ? "كل الفروع" : "فروع مخصصة"} · {r._count.users} مستخدم</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {permissions.map((p, i) => (
                <Fragment key={p.id}>
                  {(i === 0 || permissions[i - 1]!.groupAr !== p.groupAr) && (
                    <tr>
                      <td colSpan={roles.length + 1} className="border-t border-gray-200 bg-brand-50/50 px-4 py-2 text-xs font-bold text-brand-900">{p.groupAr}</td>
                    </tr>
                  )}
                  <tr className="hover:bg-gray-50">
                    <td className="sticky start-0 border-t border-gray-100 bg-white px-4 py-2">
                      {p.nameAr}
                      <span dir="ltr" className="block text-[11px] text-gray-400">{p.key}</span>
                    </td>
                    {roles.map((r) => (
                      <td key={r.id} className="border-t border-gray-100 px-3 py-2 text-center">
                        {has.get(r.id)!.has(p.id) ? (
                          <span className="text-emerald-600" aria-label="مسموح">✓</span>
                        ) : (
                          <span className="text-gray-300" aria-label="غير مسموح">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
