import { prisma } from "@/lib/db";
import { getActor, getRequestMeta } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { logWhatsAppReminder } from "@/services/reminders.service";

export const dynamic = "force-dynamic";

const page = (msg: string, status: number) =>
  new Response(
    `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تذكير واتساب</title>` +
      `<body style="font-family:system-ui,Tahoma,sans-serif;background:#f4f6f9;display:grid;place-items:center;min-height:100vh;margin:0">` +
      `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:24px 28px;max-width:420px;text-align:center">` +
      `<p style="color:#132e4b;font-weight:700;margin:0 0 8px">تعذّر تجهيز التذكير</p><p style="color:#4b5563;margin:0">${msg.replace(/[<>&"]/g, "")}</p></div></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

/**
 * يجهّز رسالة تذكير بالدفع، ويسجّلها في سجل التدقيق، ثم يحوّل إلى واتساب (wa.me).
 * الإرسال الفعلي يتم يدويًا من جهاز الموظف — مجاني ولا يمر بأي مزوّد رسائل.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return new Response("Unauthorized", { status: 401 });
  const { contractId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) return page("العقد غير موجود", 404);
  try {
    const r = await logWhatsAppReminder(prisma, actor, contractId, await getRequestMeta());
    return new Response(null, { status: 303, headers: { Location: r.url, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return page(e.status === 403 ? "العقد غير موجود" : e.message, e.status === 403 ? 404 : e.status);
    console.error("[whatsapp-reminder]", e);
    return page("حدث خطأ غير متوقع", 500);
  }
}
