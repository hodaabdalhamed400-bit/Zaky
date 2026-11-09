import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedReferenceData } from "./seed-data";

// يزرع البيانات المرجعية فقط (الصلاحيات، الأدوار، الفروع، أنواع الوحدات، الإعدادات).
// لا ينشئ أي مستخدم ولا أي بيانات مالية أو عملاء وهميين.
const db = new PrismaClient();
seedReferenceData(db)
  .then(() => console.log("✔ تمت مزامنة البيانات المرجعية"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
