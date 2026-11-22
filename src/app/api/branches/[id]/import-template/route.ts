import { prisma } from "@/lib/db";
import { getActor } from "@/lib/auth/server";
import { hasBranchAccess } from "@/lib/rbac/guard";
import { buildSimpleTemplate } from "@/lib/import-template";

export const dynamic = "force-dynamic";

/** تنزيل الشيت المبسّط لبيانات الفرع (فارغ، باسم الفرع) ليعبئه موظفو الفرع. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !actor.permissions.has("units.view") || !hasBranchAccess(actor, id)) return new Response("Not found", { status: 404 });
  const branch = await prisma.branch.findUnique({ where: { id }, select: { nameAr: true } });
  if (!branch) return new Response("Not found", { status: 404 });
  const buf = await buildSimpleTemplate(branch.nameAr);
  const name = `بيانات فرع ${branch.nameAr} - الشيت المبسط.xlsx`;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="branch-data.xlsx"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
