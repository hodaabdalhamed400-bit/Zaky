// اختبار E2E لفواتير الشراء: إضافة بصورة الفاتورة، حساب الضريبة، منع التكرار، الإرجاع والتعديل، الاعتماد، الدفع، التصدير.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const PDF = join(OUT, "supplier-invoice.pdf");
writeFileSync(PDF, "%PDF-1.4\n%supplier invoice\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const INV = `F-${Date.now().toString().slice(-6)}`;

async function login(page) {
  await page.goto(BASE + "/login");
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/");
}

async function fillInvoice(page, { total = "1150", vat } = {}) {
  await page.selectOption("#branchId", { label: "الازدهار" });
  await page.selectOption("#categoryId", { label: "صيانة وإصلاحات" });
  await page.fill("#supplierName", "مؤسسة التبريد الحديث");
  await page.fill("#supplierVatNo", "300000000000003");
  await page.fill("#invoiceNo", INV);
  await page.fill("#totalAmount", total);
  if (vat !== undefined) await page.fill("#vatAmount", vat);
  await page.fill("#description", "صيانة مكيف المكتب 101");
  await page.setInputFiles("#file", PDF);
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA", acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await login(page);

  check("فواتير الشراء في القائمة الجانبية", await page.locator('aside a[href="/purchases"]').first().isVisible());
  await page.goto(BASE + "/purchases");
  check("صفحة فارغة واضحة قبل أي فاتورة", await page.isVisible("text=لا توجد فواتير شراء بعد"));

  await page.goto(BASE + "/purchases/new");
  await fillInvoice(page);
  check("الضريبة تُقترح تلقائيًا 15% من الإجمالي", (await page.inputValue("#vatAmount")) === "150.00");
  check("معاينة المبلغ قبل الضريبة", await page.isVisible("text=1,000.00 ر.س"));
  await page.click("main form button[type=submit]");
  await page.waitForURL(/\/purchases\/[0-9a-f-]{36}\?done=created/);
  const url = page.url().split("?")[0];
  check("الحفظ برقم داخلي من تسلسل الفرع", /PI-IZD-\d{4}-00001/.test(await page.textContent("h1")));
  check("الحالة: بانتظار المراجعة", await page.isVisible("main >> text=بانتظار المراجعة"));
  check("صورة الفاتورة مرفقة", await page.isVisible("text=فاتورة شراء >> nth=0") && (await page.locator('a[href^="/api/documents/"]').count()) === 1);

  await page.goto(BASE + "/purchases/new");
  await fillInvoice(page);
  await page.click("main form button[type=submit]");
  await page.waitForSelector("form [role=alert]");
  check("منع تسجيل نفس فاتورة المورد مرتين", (await page.textContent("form [role=alert]")).includes("مسجلة مسبقًا"));
  check("البيانات المكتوبة تبقى بعد الخطأ", (await page.inputValue("#supplierName")) === "مؤسسة التبريد الحديث");

  await page.goto(url);
  await page.click("button:has-text('إرجاع للتعديل')");
  await page.fill("textarea[name=reason]", "المبلغ لا يطابق الصورة");
  await page.click("form button[type=submit]:has-text('إرجاع للتعديل')");
  await page.waitForURL(/done=reject/);
  check("الإرجاع للتعديل مع السبب", await page.isVisible("text=أُرجعت للتعديل: المبلغ لا يطابق الصورة"));

  await page.click("a:has-text('تعديل')");
  await page.waitForURL(/\/edit$/);
  await page.fill("#totalAmount", "1035");
  await page.fill("#vatAmount", "135");
  await page.click("main form button[type=submit]");
  await page.waitForURL(/done=updated/);
  check("بعد التعديل تعود للمراجعة بالمبلغ الجديد", (await page.isVisible("main >> text=بانتظار المراجعة")) && (await page.isVisible("text=1,035.00 ر.س")));

  await page.click("form button:has-text('اعتماد الفاتورة')");
  await page.waitForURL(/done=approve/);
  check("المحاسب يعتمد الفاتورة", await page.isVisible("text=تم اعتماد الفاتورة"));
  check("المعتمدة لا يظهر لها زر تعديل", (await page.locator("main a:has-text('تعديل')").count()) === 0);

  await page.selectOption("#pay-method", "BANK_TRANSFER");
  await page.click("form button:has-text('تسجيل كمدفوعة')");
  await page.waitForURL(/done=paid/);
  check("تسجيل الدفع للمورد", await page.isVisible("text=تم تسجيل الفاتورة كمدفوعة"));

  await page.goto(BASE + "/purchases");
  check("القائمة تعرض الفاتورة والمجاميع", (await page.locator("tbody tr").count()) === 1 && (await page.isVisible("text=1,035.00 ر.س")));
  await page.screenshot({ path: `${OUT}/purchases-list.png`, fullPage: true });

  await page.goto(BASE + "/reports/purchases");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("a:has-text('Excel')")]);
  const xlsx = join(OUT, "purchases.xlsx");
  await dl.saveAs(xlsx);
  const head = readFileSync(xlsx).subarray(0, 2).toString();
  const res = await page.request.get(BASE + (await page.locator("a:has-text('Excel')").first().getAttribute("href")));
  const cd = decodeURIComponent(res.headers()["content-disposition"] ?? "");
  check("تصدير تقرير فواتير الشراء Excel", head === "PK" && cd.includes("تقرير فواتير الشراء") && cd.endsWith(".xlsx"), cd);

  await page.goto(BASE + "/purchases/categories");
  await page.fill("#nameAr", "تصنيف اختبار");
  await page.click("form button[type=submit]:has-text('إضافة')");
  await page.waitForSelector("text=تمت إضافة التصنيف");
  check("إضافة تصنيف جديد", await page.isVisible("td >> text=تصنيف اختبار"));

  await page.goto(BASE + "/audit");
  check("العمليات في سجل التدقيق", (await page.isVisible("text=إضافة فاتورة شراء")) && (await page.isVisible("text=اعتماد فاتورة شراء")));
  check("لا أخطاء في وحدة التحكم", errors.length === 0, errors.join(" | "));

  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await login(m);
  for (const path of ["/purchases", "/purchases/new"]) {
    await m.goto(BASE + path);
    check(`لا تمرير أفقي على الجوال: ${path}`, !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
