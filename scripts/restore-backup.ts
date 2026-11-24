/**
 * استرجاع نسخة احتياطية من ذكي ERP إلى قاعدة بيانات جديدة.
 *   1) أنشئ قاعدة جديدة فارغة، وضع رابطها في DATABASE_URL
 *   2) npx prisma migrate deploy        (بدون seed)
 *   3) RESTORE_PASSPHRASE='...' npm run backup:restore -- ملف-النسخة.zakibak
 * الملفات المرفوعة تُكتب في STORAGE_DIR. التفاصيل في docs/BACKUP.md
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parsePayload, decrypt, restoreBackup } from "../src/lib/backup";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const pass = process.env.RESTORE_PASSPHRASE ?? "";
if (!file || !pass) {
  console.error("الاستخدام: RESTORE_PASSPHRASE='كلمة السر' npm run backup:restore -- <ملف النسخة> [--check] [--force]");
  process.exit(2);
}
const data = readFileSync(file);

(async () => {
  if (args.includes("--check")) {
    // فحص فقط: يفك التشفير ويعرض المحتوى بدون أي كتابة
    const { info } = parsePayload(decrypt(data, pass));
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const db = new PrismaClient();
  try {
    const r = await restoreBackup(db, data, pass, { force: args.includes("--force") });
    const rows = Object.values(r.restored).reduce((a, b) => a + b, 0);
    console.log(`✔ تم الاسترجاع: ${rows} سجل في ${Object.keys(r.restored).length} جدول، و${r.files} ملف. (نسخة ${r.info.createdAt})`);
  } finally {
    await db.$disconnect();
  }
})().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
