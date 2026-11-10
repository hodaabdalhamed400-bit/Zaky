import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { runDaily } from "@/services/jobs.service";

export const dynamic = "force-dynamic";

/**
 * مهمة الصيانة اليومية (تحديث حالات العقود المنتهية + مسودات التجديد).
 * تُستدعى من Render Cron Job: POST مع ترويسة Authorization: Bearer <CRON_SECRET>.
 * بديل بدون HTTP: npm run job:daily
 */
export async function POST(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return new Response("Not configured", { status: 404 });
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("Unauthorized", { status: 401 });
  const result = await runDaily(prisma);
  return Response.json(result);
}
