import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { listUsers } from "@/services/users.service";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, inputClass, buttonClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "المستخدمون" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requirePageActor("users.view");
  const { q } = await searchParams;
  const users = await listUsers(prisma, actor, { q });
  const canManage = actor.permissions.has("users.manage");

  return (
    <>
      <PageHeader
        title="المستخدمون"
        description="حسابات الموظفين وأدوارهم والفروع المصرح لهم بها."
        actions={canManage ? <LinkButton href="/users/new" icon="plus">مستخدم جديد</LinkButton> : undefined}
      />
      <Card>
        <form className="flex gap-2 border-b border-gray-100 p-4" role="search">
          <label htmlFor="q" className="sr-only">بحث</label>
          <input id="q" name="q" defaultValue={q} placeholder="بحث بالاسم أو البريد…" className={inputClass + " max-w-sm"} />
          <button className={buttonClass("secondary")}>بحث</button>
        </form>
        {users.length === 0 ? (
          <EmptyState title="لا يوجد مستخدمون مطابقون" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الاسم</Th>
                <Th>البريد</Th>
                <Th>الدور</Th>
                <Th>الفروع</Th>
                <Th>الحالة</Th>
                <Th>آخر دخول</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <Td>
                    <Link href={`/users/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.name}</Link>
                  </Td>
                  <Td><span dir="ltr">{u.email}</span></Td>
                  <Td>{u.role.nameAr}</Td>
                  <Td className="max-w-56">
                    {u.role.allBranches ? (
                      <Badge color="brand">جميع الفروع</Badge>
                    ) : u.branchAccess.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      <span className="text-xs text-gray-600">{u.branchAccess.map((b) => b.branch.nameAr).join("، ")}</span>
                    )}
                  </Td>
                  <Td>
                    {u.isActive ? <Badge color="green">نشط</Badge> : <Badge color="red">معطل</Badge>}
                    {u.mustChangePassword && <span className="ms-1"><Badge color="amber">كلمة مرور مؤقتة</Badge></span>}
                  </Td>
                  <Td className="tabular text-xs text-gray-500">{formatDateTime(u.lastLoginAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
