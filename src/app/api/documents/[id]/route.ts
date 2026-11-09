import { prisma } from "@/lib/db";
import { getActor, getRequestMeta } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { readDocument } from "@/services/documents.service";

export const dynamic = "force-dynamic";

/** تنزيل مستند بعد التحقق من الجلسة والصلاحيات والفرع — لا توجد روابط عامة للملفات. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  try {
    const { doc, data } = await readDocument(prisma, actor, id, await getRequestMeta());
    const inline = new URL(req.url).searchParams.get("inline") === "1" && doc.mimeType !== "application/pdf" ? "inline" : "attachment";
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline}; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? e.status : 500;
    if (status === 500) console.error("[document-download]", e);
    return new Response(status === 403 || status === 404 ? "Not found" : "Error", { status: status === 403 ? 404 : status });
  }
}
