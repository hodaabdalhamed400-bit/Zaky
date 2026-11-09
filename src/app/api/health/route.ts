import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** فحص صحة الخدمة لـ Render — لا يكشف أي معلومات داخلية. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "db_unavailable" }, { status: 503 });
  }
}
