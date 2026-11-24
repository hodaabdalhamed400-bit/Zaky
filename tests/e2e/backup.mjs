// اختبار E2E لصفحة النسخ الاحتياطي: تنزيل نسخة مشفرة، ثم فحصها بسكربت الاسترجاع.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const browser = await chromium.launch();
try {
  const page = await (await browser.newContext({ acceptDownloads: true, locale: "ar-SA" })).newPage();
  await page.goto(BASE + "/login");
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname === "/");
  check("رابط النسخ الاحتياطي في القائمة", await page.isVisible("nav a[href='/backup']"));
  await page.goto(BASE + "/backup");
  await page.fill("[data-backup-form] input[name=passphrase]", "E2E-Backup-Pass-99");
  await page.fill("[data-backup-form] input[name=confirm]", "Mismatch-Pass-9999");
  await page.click("[data-backup-form] button[type=submit]");
  await page.waitForURL(/error=/);
  check("كلمتا سر مختلفتان تُرفض", await page.isVisible("text=غير متطابقتين"));
  await page.fill("[data-backup-form] input[name=passphrase]", "E2E-Backup-Pass-99");
  await page.fill("[data-backup-form] input[name=confirm]", "E2E-Backup-Pass-99");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("[data-backup-form] button[type=submit]")]);
  const path = `${OUT}/e2e-backup.zakibak`;
  await dl.saveAs(path);
  const info = JSON.parse(execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/restore-backup.ts", path, "--check"], { env: { ...process.env, RESTORE_PASSPHRASE: "E2E-Backup-Pass-99" } }).toString());
  check("النسخة تُفك بكلمة السر وفيها البيانات", info.tables.users > 0 && info.tables.contracts >= 0, `files=${info.files}`);
  await page.goto(BASE + "/backup");
  check("التنزيل مسجل في «آخر النسخ»", await page.isVisible("text=تنزيل يدوي"));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
