import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "./test-db";

/** يعيد بناء قاعدة الاختبار من الترحيلات الحقيقية (نفس ما يُنشر للإنتاج) ثم يزرع البيانات المرجعية. */
export default async function setup() {
  const db = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  await db.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await db.$executeRawUnsafe("CREATE SCHEMA public");
  await db.$disconnect();
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  const { seedReferenceData } = await import("../prisma/seed-data");
  const db2 = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
  await seedReferenceData(db2);
  await db2.$disconnect();
}
