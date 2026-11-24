import { prisma } from "@/lib/db";
import { getActor, getRequestMeta } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { todayInRiyadh } from "@/lib/dates";
import { downloadBackup } from "@/services/backup.service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** تنزيل نسخة احتياطية مشفرة (POST من صفحة النسخ الاحتياطي — كلمة السر لا تمر في الرابط). */
export async function POST(req: Request) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  // حماية من الطلبات من مواقع أخرى
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return new Response("Forbidden", { status: 403 });
  const fd = await req.formData();
  const pass = String(fd.get("passphrase") ?? "");
  const confirm = String(fd.get("confirm") ?? "");
  const back = (msg: string) => new Response(null, { status: 303, headers: { Location: `/backup?error=${encodeURIComponent(msg)}` } });
  if (pass !== confirm) return back("كلمتا السر غير متطابقتين");
  try {
    const { file } = await downloadBackup(prisma, actor, pass, fd.get("files") === "1", await getRequestMeta());
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="zaki-erp-backup-${todayInRiyadh()}.zakibak"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return e.status === 403 ? new Response("Forbidden", { status: 403 }) : back(e.message);
    console.error("[backup]", e);
    return back("تعذّر إنشاء النسخة، حاول مرة أخرى");
  }
}
