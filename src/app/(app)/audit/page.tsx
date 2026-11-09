import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { formatDateTime } from "@/lib/dates";
import { Card, EmptyState, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "سجل التدقيق" };
const PAGE = 50;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  await requirePageActor("audit.view");
  const { before } = await searchParams;
  const cursor = before && /^\d+$/.test(before) ? BigInt(before) : undefined;
  const rows = await prisma.auditLog.findMany({
    where: cursor ? { id: { lt: cursor } } : undefined,
    orderBy: { id: "desc" },
    take: PAGE,
    include: { user: { select: { name: true, email: true } } },
  });
  const last = rows.at(-1);

  return (
    <>
      <PageHeader title="سجل التدقيق" description="سجل غير قابل للتعديل أو الحذف لجميع العمليات المهمة." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="لا توجد سجلات" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>الوقت</Th>
                <Th>المستخدم</Th>
                <Th>العملية</Th>
                <Th>الكيان</Th>
                <Th>التفاصيل</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id.toString()} className="align-top">
                  <Td className="tabular whitespace-nowrap text-xs text-gray-500">{formatDateTime(r.createdAt)}</Td>
                  <Td>{r.user?.name ?? "النظام"}</Td>
                  <Td>{AUDIT_ACTION_LABELS[r.action] ?? r.action}</Td>
                  <Td className="text-xs text-gray-500"><span dir="ltr">{r.entityType}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</span></Td>
                  <Td>
                    {(r.before || r.after) ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand-700">عرض</summary>
                        <pre dir="ltr" className="mt-2 max-w-md overflow-x-auto rounded bg-gray-50 p-2 text-start text-[11px]">
                          {JSON.stringify({ before: r.before, after: r.after }, null, 2)}
                        </pre>
                      </details>
                    ) : <span className="text-gray-300">—</span>}
                  </Td>
                  <Td className="text-xs text-gray-400"><span dir="ltr">{r.ip ?? "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {rows.length === PAGE && last && (
        <div className="mt-4 flex justify-center">
          <Link href={`/audit?before=${last.id}`} className={buttonClass("secondary")}>السجلات الأقدم</Link>
        </div>
      )}
    </>
  );
}
