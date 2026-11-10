import { prisma } from "@/lib/db";
import { getActor, getRequestMeta } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { buildWorkbook } from "@/lib/excel";
import { todayInRiyadh } from "@/lib/dates";
import { runReport } from "@/services/reports.service";
import { filtersSummary } from "@/components/reports/report-table";

export const dynamic = "force-dynamic";

/** تصدير تقرير إلى Excel بعد التحقق من الجلسة وصلاحيتي التقارير والتصدير وصلاحيات بيانات التقرير والفروع. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  const { key } = await params;
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  try {
    const r = await runReport(prisma, actor, key, sp, { forExport: true });
    const branch = r.filters.branchId ? await prisma.branch.findUnique({ where: { id: r.filters.branchId }, select: { nameAr: true } }) : null;
    const buf = await buildWorkbook({
      title: r.def.title,
      subtitle: filtersSummary(r.filters, branch?.nameAr ?? null, r.filters.status && r.def.statuses ? (r.def.statuses[r.filters.status] ?? null) : null),
      generatedBy: actor.name,
      columns: r.columns,
      rows: r.rows,
      totals: r.totals,
      note: r.note,
    });
    await writeAudit(prisma, { actorId: actor.id, action: "report.export", entityType: "report", entityId: key, branchId: r.filters.branchId ?? null, after: { format: "xlsx", filters: r.filters, rows: r.rows.length }, meta: await getRequestMeta() });
    const name = `${r.def.title} ${todayInRiyadh()}.xlsx`;
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="report.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status === 500) console.error("[report-export]", e);
    return new Response(status === 403 ? "Forbidden" : status === 404 ? "Not found" : "Error", { status });
  }
}
