/**
 * يتحقق أن الاستعادة مطابقة للمصدر: عدد السجلات لكل جدول، المجاميع المالية، الترحيلات،
 * القيود والمشغلات (Triggers) تعمل في القاعدة المستعادة، وسلامة ملفات المستندات (SHA-256).
 * الاستخدام: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... [RESTORED_STORAGE_DIR=...] npx tsx scripts/verify-restore.ts
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const src = new PrismaClient({ datasourceUrl: process.env.SOURCE_DATABASE_URL });
const dst = new PrismaClient({ datasourceUrl: process.env.TARGET_DATABASE_URL });
let failures = 0;
const ok = (name: string, pass: boolean, extra = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

async function q<T>(db: PrismaClient, sql: string) {
  return db.$queryRawUnsafe<T[]>(sql);
}

async function main() {
  const tables = (await q<{ t: string }>(src, "SELECT tablename AS t FROM pg_tables WHERE schemaname='public' ORDER BY 1")).map((r) => r.t);
  let rows = 0;
  for (const t of tables) {
    const [a] = await q<{ n: bigint }>(src, `SELECT count(*) AS n FROM "${t}"`);
    const [b] = await q<{ n: bigint }>(dst, `SELECT count(*) AS n FROM "${t}"`);
    rows += Number(a!.n);
    if (a!.n !== b!.n) ok(`عدد سجلات ${t}`, false, `${a!.n} ≠ ${b!.n}`);
  }
  ok(`عدد السجلات متطابق في ${tables.length} جدولًا`, failures === 0, `${rows} سجل`);

  const money = `SELECT
    (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='APPROVED')::text AS paid,
    (SELECT COALESCE(SUM(amount_due),0) FROM payment_schedules)::text AS due,
    (SELECT COALESCE(SUM(total_amount),0) FROM contracts)::text AS contracts,
    (SELECT COALESCE(MAX(id),0) FROM audit_logs)::text AS audit,
    (SELECT string_agg(key||'='||last_value, ',' ORDER BY key) FROM number_sequences) AS seq`;
  const [m1] = await q<Record<string, string>>(src, money);
  const [m2] = await q<Record<string, string>>(dst, money);
  ok("المجاميع المالية وتسلسلات الأرقام متطابقة", JSON.stringify(m1) === JSON.stringify(m2), `محصّل ${m2!.paid} · مستحق ${m2!.due} · عقود ${m2!.contracts}`);

  const [mig] = await q<{ n: bigint }>(dst, "SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL");
  const [migS] = await q<{ n: bigint }>(src, "SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL");
  ok("سجل الترحيلات مستعاد", mig!.n === migS!.n, `${mig!.n} ترحيل`);

  const [cons] = await q<{ n: bigint }>(dst, "SELECT count(*) AS n FROM pg_constraint WHERE conname IN ('contract_units_no_overlap','payments_approval_consistent','schedules_amounts_valid','adjustments_no_late_fee')");
  ok("قيود السلامة موجودة (EXCLUDE وCHECK)", Number(cons!.n) === 4);

  let blocked = false;
  try {
    await dst.$executeRawUnsafe("UPDATE audit_logs SET action = 'tampered' WHERE id = (SELECT MIN(id) FROM audit_logs)");
  } catch (e) {
    blocked = String(e).includes("ZAKI_APPEND_ONLY");
  }
  ok("مشغل حماية سجل التدقيق يعمل في القاعدة المستعادة", blocked);

  const dir = process.env.RESTORED_STORAGE_DIR;
  if (dir) {
    const docs = await dst.document.findMany({ select: { storageKey: true, sha256: true } });
    let good = 0;
    for (const d of docs) {
      try {
        const data = await readFile(join(dir, d.storageKey));
        if (createHash("sha256").update(data).digest("hex") === d.sha256) good++;
      } catch {
        /* مفقود */
      }
    }
    ok("ملفات المستندات المستعادة سليمة (SHA-256)", good === docs.length, `${good}/${docs.length}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await src.$disconnect();
    await dst.$disconnect();
    console.log(failures ? `\n✖ فشل التحقق (${failures})` : "\n✔ الاستعادة مطابقة للمصدر");
    process.exit(failures ? 1 : 0);
  });
