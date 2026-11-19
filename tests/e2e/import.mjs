// اختبار E2E لاستيراد بيانات الفرع من Excel (ملف تجريبي يُبنى هنا — لا بيانات حقيقية).
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ExcelJS = require("exceljs");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const browser = await chromium.launch();

const H = {
  "الوحدات": ["الفرع (تلقائي)", "رقم الوحدة / المكتب *", "نوع الوحدة *", "الدور", "المساحة م²", "السعة (عدد المقاعد) *", "السعر الأساسي شامل الضريبة (ر.س) *", "دورة التسعير *", "الحالة الحالية *"],
  "العملاء": ["اسم العميل / المنشأة *", "نوع العميل *", "الفرع الأساسي (تلقائي)", "اسم الشخص المسؤول", "الجوال *", "البريد الإلكتروني", "السجل التجاري", "الرقم الضريبي", "رقم الهوية (اختياري)", "العنوان الوطني", "حالة العميل *"],
  "العقود": ["رقم مرجع العقد *", "رقم العقد الورقي (إن وجد)", "اسم العميل *", "الفرع (تلقائي)", "رقم الوحدة *", "عدد المقاعد", "الإيجار الشهري للوحدة شامل الضريبة (ر.س) *", "تاريخ بداية العقد *", "مدة العقد (بالأشهر) *", "تاريخ النهاية (تلقائي)", "دورة الدفع *"],
  "السداد": ["رقم مرجع العقد *", "اسم العميل (تلقائي)", "إجمالي قيمة العقد (تلقائي)", "إجمالي المسدد حتى اليوم (ر.س) *"],
};
async function makeFile(path, branch, rows) {
  const wb = new ExcelJS.Workbook();
  for (const [name, head] of Object.entries(H)) {
    const ws = wb.addWorksheet(name);
    ws.addRow(["عنوان"]); ws.addRow(["شرح"]); ws.addRow(head);
    for (const r of rows[name] ?? []) ws.addRow(r.map((v) => (v === "$B" ? branch : v)));
  }
  writeFileSync(path, Buffer.from(await wb.xlsx.writeBuffer()));
}

async function login(page) {
  await page.goto(BASE + "/login");
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname === "/");
}

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await login(page);
  // فرع جديد فارغ للاختبار
  const code = "IM" + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z]/g, "X");
  const name = "فرع الاستيراد " + code;
  await page.goto(BASE + "/branches/new");
  await page.fill("#code", code);
  await page.fill("#nameAr", name);
  await page.click("form:has(#nameAr) button[type=submit]");
  await page.waitForURL(/\/branches\/[0-9a-f-]{36}/);
  const branchUrl = page.url().split("?")[0];
  await page.click("a:has-text('استيراد من Excel')");
  await page.waitForURL(/\/import$/);
  check("صفحة الاستيراد تفتح من صفحة الفرع", await page.isVisible("[data-import-form]"));

  const start = new Date(Date.now() - 20 * 86400000);
  const bad = `${OUT}/import-bad.xlsx`;
  await makeFile(bad, name, {
    "الوحدات": [["$B", "1", "مكتب خاص", "الأول", 7.5, null, 1725, "شهري", "مؤجرة"]],
    "العقود": [[1, null, "عميل غير موجود", "$B", "1", null, 1725, null, 6, null, "شهري"]],
  });
  await page.setInputFiles("[data-import-file]", bad);
  await page.click("button[value=preview]");
  await page.waitForSelector("[data-import-preview]");
  check("المعاينة تعرض الأخطاء", await page.isVisible("text=السعة (عدد المقاعد) فارغة") && await page.isVisible("text=تاريخ بداية العقد فارغ"));
  check("زر الاستيراد لا يظهر مع وجود أخطاء", (await page.locator("[data-import-commit]").count()) === 0);

  const good = `${OUT}/import-good.xlsx`;
  const cr = String(Math.floor(1e9 + Math.random() * 8.9e9));
  await makeFile(good, name, {
    "الوحدات": [["$B", "1", "مكتب خاص", "الأول", 7.5, 2, 1725, "شهري", "مؤجرة"], ["$B", "2", "مكتب خاص", "الأول", 7.5, 2, 1725, "شهري", "متاحة"]],
    "العملاء": [["شركة اختبار الاستيراد " + code, "منشأة", "$B", "سالم", "0551112223", null, cr, null, null, null, "نشط"]],
    "العقود": [[1, "555", "شركه اختبار الاستيراد " + code, "$B", "1", null, 1725, start, 6, null, "شهري"]],
    "السداد": [[1, null, null, 1725]],
  });
  await page.setInputFiles("[data-import-file]", good);
  await page.click("button[value=preview]");
  await page.waitForSelector("[data-import-commit]");
  check("الملف السليم يُظهر زر الاستيراد", true);
  check("المعاينة تحسب إجمالي العقد", await page.isVisible("text=10,350.00"));
  await page.screenshot({ path: `${OUT}/import-preview.png`, fullPage: true });
  await page.click("[data-import-commit]");
  await page.waitForSelector("[data-import-result]", { timeout: 30000 });
  check("الاستيراد ينجح", await page.isVisible("text=تم الاستيراد: 2 وحدة، 1 عميل، 1 عقد معتمد، 1 دفعة مسددة"));
  await page.goto(BASE + "/contracts?q=" + encodeURIComponent("اختبار الاستيراد " + code));
  check("العقد يظهر في العقود", await page.isVisible("text=نشط"));
  await page.goto(BASE + "/audit");
  check("الاستيراد في سجل التدقيق", await page.isVisible("text=استيراد بيانات الفرع من Excel"));
  check("لا أخطاء في الصفحة", errors.length === 0, errors.join(" | ").slice(0, 300));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
