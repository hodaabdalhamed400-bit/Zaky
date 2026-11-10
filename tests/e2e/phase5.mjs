// اختبار E2E للمرحلة الخامسة (الرسوم، التقارير، التصدير، الإشعارات). يُشغَّل بعد phase4.mjs ثم `npm run job:daily`.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const ExcelJS = require(join(process.cwd(), "node_modules/exceljs"));

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const mainSubmit = (page, text) => page.click(`main form button[type=submit]:has-text("${text}")`);
async function login(page, email, password) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function newUser(page, { name, email, role, branch, temp }) {
  await page.goto(BASE + "/users/new");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.selectOption("#roleId", { label: role });
  await page.fill("#password", temp);
  if (branch) await page.getByLabel(branch).check();
  await mainSubmit(page, "إنشاء المستخدم");
  await page.waitForSelector("text=تم إنشاء المستخدم بنجاح");
}
async function firstLogin(page, email, temp, real) {
  await login(page, email, temp);
  await page.fill("#currentPassword", temp);
  await page.fill("#newPassword", real);
  await page.fill("#confirmPassword", real);
  await mainSubmit(page, "تغيير كلمة المرور");
  await page.waitForURL((u) => u.pathname === "/");
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA", acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await login(page, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);

  // ── الرسوم البيانية ──
  await page.goto(BASE + "/");
  for (const t of ["المستحقات مقابل المحصّل", "تطور الإشغال", "نسبة الإشغال حسب الفرع", "العقود الجديدة والمنتهية"])
    check(`رسم بياني: ${t}`, (await page.locator(`section[aria-label="${t}"] svg.recharts-surface`).count()) === 1);
  await page.screenshot({ path: `${OUT}/p5-dashboard.png`, fullPage: true });
  await page.locator('section[aria-label="المستحقات مقابل المحصّل"] summary').click();
  check("كل رسم له جدول بيانات بديل", (await page.locator('section[aria-label="المستحقات مقابل المحصّل"] details tbody tr').count()) === 12);
  await page.selectOption("#range", "6");
  await page.click("button:has-text('عرض')");
  await page.waitForURL(/range=6/);
  await page.locator('section[aria-label="العقود الجديدة والمنتهية"] summary').click();
  check("فلتر الفترة: 6 أشهر", (await page.locator('section[aria-label="العقود الجديدة والمنتهية"] details tbody tr').count()) === 6);
  await page.locator('section[aria-label="المستحقات مقابل المحصّل"] path.recharts-rectangle').first().hover();
  check("تلميح عربي عند المرور على الأعمدة", await page.locator(".recharts-tooltip-wrapper >> text=المحصّل في الشهر").isVisible());

  // ── الإشعارات ──
  const bellLabel = await page.locator('main a[href="/notifications"]').getAttribute("aria-label");
  check("جرس الإشعارات يعرض عدد غير المقروء بعد المهمة اليومية", /غير مقروء/.test(bellLabel ?? ""), bellLabel);
  await page.goto(BASE + "/notifications");
  check("مركز الإشعارات يعرض تنبيه قسط متأخر", await page.isVisible("text=قسط متأخر"));
  await page.screenshot({ path: `${OUT}/p5-notifications.png`, fullPage: true });

  const acc = `acc-${Date.now()}@zaki.local`;
  await newUser(page, { name: "محاسب الازدهار", email: acc, role: "المحاسب", branch: "الازدهار", temp: "Acc-Temp-Pass-1" });
  // تسجيل دفعة جديدة من المسؤول → تنبيه للمحاسب
  await page.goto(BASE + "/finance/payments/new");
  await page.selectOption("#contractId", { index: 1 });
  await page.click("button:has-text('متابعة')");
  await page.fill("#amount", "100");
  await page.click("button:has-text('توزيع على الأقدم أولًا')");
  await page.selectOption("#method", "CASH");
  await mainSubmit(page, "تسجيل الدفعة");
  await page.waitForURL(/done=recorded/);
  const paymentPath = new URL(page.url()).pathname;
  await page.click("text=تسجيل الخروج");

  await firstLogin(page, acc, "Acc-Temp-Pass-1", "Acc-Real-Pass-22");
  await page.goto(BASE + "/notifications?filter=unread");
  const pending = page.locator("li:has-text('دفعة بانتظار المراجعة: 100.00')");
  check("المحاسب يستلم تنبيه الدفعة بانتظار المراجعة", (await pending.count()) === 1);
  await pending.locator("button:has-text('فتح')").click();
  await page.waitForURL((u) => u.pathname === paymentPath);
  check("فتح التنبيه ينقل للدفعة ويعلّمه مقروءًا", true);
  await page.click("button:has-text('اعتماد وإصدار إيصال')");
  await page.waitForURL(/done=approve/);
  await page.goto(BASE + "/notifications?filter=unread");
  check("اعتماد الدفعة يغلق تنبيهها", (await page.locator("li:has-text('دفعة بانتظار المراجعة: 100.00')").count()) === 0);
  check("المحاسب لا يرى تقرير نشاط الموظفين", !(await (await page.goto(BASE + "/reports"), page).isVisible("text=تقرير نشاط الموظفين")));
  await page.click("text=تسجيل الخروج");

  // ── التقارير والتصدير ──
  await login(page, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  await page.goto(BASE + "/reports");
  check("ثمانية تقارير لمسؤول النظام", (await page.locator("main a[href^='/reports/']").count()) === 8);
  await page.goto(BASE + "/reports/branches");
  check("تقرير الفروع يعرض 11 فرعًا مع إجمالي", (await page.locator("tbody tr").count()) === 11 && (await page.isVisible("tfoot >> text=الإجمالي")));
  await page.screenshot({ path: `${OUT}/p5-report.png`, fullPage: true });

  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("a:has-text('تصدير Excel')")]);
  const xlsx = join(OUT, "branches.xlsx");
  await dl.saveAs(xlsx);
  // متصفح Playwright بلا واجهة يعرض الاسم "download"؛ نتحقق من الترويسة التي تستخدمها المتصفحات
  const head = await page.request.get(BASE + "/api/reports/branches");
  const cd = decodeURIComponent(head.headers()["content-disposition"] ?? "");
  check("اسم ملف Excel عربي في ترويسة التنزيل", cd.includes("تقرير الفروع") && cd.endsWith(".xlsx"), cd);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const ws = wb.worksheets[0];
  const headers = ws.getRow(4).values.filter(Boolean);
  const names = [];
  ws.eachRow((r, i) => { if (i > 4) names.push(String(r.getCell(1).text)); });
  check("Excel: من اليمين لليسار وترويسة عربية", ws.views[0].rightToLeft === true && headers[0] === "الفرع" && headers.includes("المحصّل في الفترة"));
  check("Excel: أسماء الفروع العربية والإجمالي", names.includes("الازدهار") && names.includes("الإجمالي"));
  const izd = [...Array(ws.rowCount).keys()].map((i) => ws.getRow(i + 1)).find((r) => r.getCell(1).text === "الازدهار");
  check("Excel: المبالغ أرقام حقيقية بتنسيق مالي", typeof izd.getCell(9).value === "number" && izd.getCell(9).numFmt === "#,##0.00");

  await page.goto(BASE + "/reports/collections");
  await page.click("a:has-text('PDF / طباعة')");
  await page.waitForURL(/\/print\/reports\/collections/);
  await page.emulateMedia({ media: "print" });
  const pdfPath = join(OUT, "collections.pdf");
  await page.pdf({ path: pdfPath, format: "A4", landscape: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  const text = execFileSync("pdftotext", ["-layout", pdfPath, "-"]).toString();
  writeFileSync(join(OUT, "collections.txt"), text);
  // pdftotext يفكك بعض الحروف المركبة (لا/شر) عند الاستخراج، لذلك نفحص كلمات خالية منها؛
  // العرض المرئي يُفحص بصورة الصفحة المحفوظة (p5-pdf-page.png)
  const fonts = execFileSync("pdffonts", [pdfPath]).toString();
  check("PDF: الخط العربي مضمّن مع خريطة Unicode", /IBMPlexSansArabic/.test(fonts) && /yes\s+yes\s+yes/.test(fonts));
  check("PDF: العنوان العربي قابل للاستخراج", text.includes("التحصيل"));
  check("PDF: المستأجر ورقم الإيصال والمبلغ", text.includes("الريادة للتقنية") && /RC-IZD-\d{4}-0000\d/.test(text) && text.includes("100.00"));
  execFileSync("pdftoppm", ["-r", "70", "-png", "-f", "1", "-l", "1", "-singlefile", pdfPath, join(OUT, "p5-pdf-page")]);
  await page.screenshot({ path: `${OUT}/p5-print-report.png`, fullPage: true });

  await page.goto(BASE + "/audit");
  check("سجل التدقيق يسجل عمليات التصدير", (await page.locator("td:has-text('تصدير تقرير')").count()) >= 2);

  // ── مستخدم اطلاع فقط ──
  const ro = `ro-${Date.now()}@zaki.local`;
  await newUser(page, { name: "اطلاع الازدهار", email: ro, role: "اطلاع فقط", branch: "الازدهار", temp: "View-Temp-Pass-1" });
  await page.click("text=تسجيل الخروج");
  await firstLogin(page, ro, "View-Temp-Pass-1", "View-Real-Pass-22");
  await page.goto(BASE + "/reports/contracts");
  check("الاطلاع فقط: يرى التقرير بلا أزرار تصدير", (await page.isVisible("h1:has-text('تقرير العقود')")) && (await page.locator("a:has-text('تصدير Excel')").count()) === 0);
  const res = await page.request.get(BASE + "/api/reports/contracts");
  check("الاطلاع فقط: التصدير المباشر مرفوض من الخادم", res.status() === 403, String(res.status()));
  await page.goto(BASE + "/print/reports/contracts");
  check("الاطلاع فقط: صفحة PDF مرفوضة", page.url().includes("/forbidden"));
  check("لا أخطاء في وحدة التحكم", errors.length === 0, errors.join(" | "));
  await ctx.close();

  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await login(m, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  for (const path of ["/", "/reports", "/reports/branches", "/notifications"]) {
    await m.goto(BASE + path);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`لا تمرير أفقي على الجوال: ${path}`, !overflow);
  }
  check("جرس الإشعارات ظاهر على الجوال", await m.locator('header a[href="/notifications"], div.sticky a[href="/notifications"]').first().isVisible());
  await m.goto(BASE + "/");
  await m.screenshot({ path: `${OUT}/p5-mobile-dashboard.png`, fullPage: true });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
