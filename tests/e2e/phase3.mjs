// اختبار E2E للمرحلة الثالثة (المستأجرون والعقود والمرفقات). يُشغَّل بعد phase2.mjs على نفس القاعدة.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const PDF = join(OUT, "sample.pdf");
writeFileSync(PDF, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const FAKE = join(OUT, "fake.pdf");
writeFileSync(FAKE, "<html><script>alert(1)</script></html>");

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const plusDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mainSubmit = (page, text) => page.click(`main form button[type=submit]:has-text("${text}")`);

async function login(page, email, password) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ar-SA" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await login(page, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);

  // ── ملف العميل ──
  await page.goto(BASE + "/tenants/new");
  await page.fill("#name", "شركة الريادة للتقنية");
  await page.selectOption("#primaryBranchId", { label: "الازدهار" });
  await page.fill("#mobile", "0551112233");
  await page.fill("#email", "info@riyada.test");
  await page.fill("#crNumber", "1010101010");
  await page.fill("#vatNumber", "300000000000003");
  await page.fill("#nationalId", "1000000001");
  await mainSubmit(page, "حفظ");
  await page.waitForURL(/\/tenants\/[0-9a-f-]{36}\?saved=1/);
  const tenantUrl = page.url().split("?")[0];
  check("إنشاء ملف عميل", await page.isVisible("h1:has-text('شركة الريادة للتقنية')"));
  check("رقم الهوية يظهر للمسؤول", await page.isVisible("text=1000000001"));

  await page.goto(BASE + "/tenants/new");
  await page.fill("#name", "عميل آخر");
  await page.selectOption("#primaryBranchId", { label: "الازدهار" });
  await page.fill("#mobile", "0551112233");
  await mainSubmit(page, "حفظ");
  await page.waitForSelector("text=يوجد عميل بنفس الجوال");
  check("تنبيه تكرار الجوال مع خيار التأكيد", await page.isVisible("text=تحققت من أنه عميل مختلف"));

  await page.goto(tenantUrl);
  await page.selectOption("#doc-category", "COMMERCIAL_REGISTER");
  await page.setInputFiles("#doc-file", PDF);
  await mainSubmit(page, "رفع المستند");
  await page.waitForSelector("text=تم رفع المستند");
  check("رفع مستند PDF للعميل", await page.isVisible("a:has-text('sample.pdf')"));
  const dl = await page.request.get(BASE + (await page.getAttribute("a:has-text('sample.pdf')", "href")));
  check("تنزيل المستند عبر مسار محمي", dl.status() === 200 && dl.headers()["cache-control"]?.includes("no-store"));
  await page.selectOption("#doc-category", "ID_DOCUMENT");
  await page.setInputFiles("#doc-file", PDF);
  await mainSubmit(page, "رفع المستند");
  await page.waitForFunction(() => document.querySelectorAll("a[href^='/api/documents/']").length === 2);
  await page.selectOption("#doc-category", "OTHER");
  await page.setInputFiles("#doc-file", FAKE);
  await mainSubmit(page, "رفع المستند");
  await page.waitForSelector("text=نوع الملف غير مسموح");
  check("رفض ملف HTML متنكر بامتداد PDF", true);

  await page.fill("#c-name", "خالد المدير المالي");
  await page.fill("#c-mobile", "0559998877");
  await mainSubmit(page, "إضافة");
  await page.waitForSelector("li:has-text('خالد المدير المالي')");
  await page.fill("#i-body", "زار الفرع واطلع على المكتب 101");
  await mainSubmit(page, "تسجيل");
  await page.waitForSelector("text=زار الفرع واطلع على المكتب 101");
  check("جهات الاتصال وسجل التواصل", true);

  // ── العقد ──
  await page.click("a:has-text('عقد جديد')");
  await page.waitForURL(/\/contracts\/new/);
  check("نموذج العقد يختار فرع العميل تلقائيًا", (await page.locator("#branchId option:checked").textContent()) === "الازدهار");
  await page.fill("#startDate", today);
  await page.selectOption("#pick-unit", { label: "101 — مكتب خاص" });
  await page.click("button:has-text('إضافة الوحدة')");
  check("السعر الشهري يُقترح من سعر الوحدة", (await page.inputValue("#price-0")) === "2500.00");
  check("معاينة الإجمالي فورًا (30,000)", await page.isVisible("text=30,000.00 ر.س"));
  await page.screenshot({ path: `${OUT}/p3-contract-form.png`, fullPage: true });
  await mainSubmit(page, "حفظ كمسودة");
  await page.waitForURL(/\/contracts\/[0-9a-f-]{36}\?done=created/);
  const contractUrl = page.url().split("?")[0];
  const contractNo = (await page.textContent("h1")).replace("العقد ", "").trim();
  check("حفظ مسودة برقم ZK-IZD-السنة-0001", /^ZK-IZD-\d{4}-0001$/.test(contractNo), contractNo);

  await page.click("button:has-text('إرسال للاعتماد')");
  await page.waitForURL(/done=submit/);
  await page.click("button:has-text('اعتماد العقد')");
  await page.waitForURL(/done=approve/);
  const scheduleRows = await page.locator("section:has(h2:text-is('جدول الأقساط')) tbody tr").count();
  check("الاعتماد ينشئ 12 قسطًا", scheduleRows === 12, `rows=${scheduleRows}`);
  check("حالة العقد نشط", await page.isVisible("main >> text=نشط"));
  await page.screenshot({ path: `${OUT}/p3-contract-detail.png`, fullPage: true });

  await page.selectOption("#doc-category", "CONTRACT_SIGNED");
  await page.setInputFiles("#doc-file", PDF);
  await mainSubmit(page, "رفع المستند");
  await page.waitForSelector("text=تم رفع المستند");
  check("رفع نسخة العقد الموقعة", await page.isVisible("text=عقد موقّع"));

  // عقد متعارض
  await page.goto(`${BASE}/contracts/new`);
  await page.selectOption("#branchId", { label: "الازدهار" });
  await page.selectOption("#tenantId", { index: 1 });
  await page.fill("#startDate", plusDays(today, 30));
  await page.selectOption("#pick-unit", { label: "101 — مكتب خاص" });
  await page.click("button:has-text('إضافة الوحدة')");
  await mainSubmit(page, "حفظ كمسودة");
  await page.waitForSelector("form [role=alert]");
  check("منع عقد متعارض على نفس الوحدة", (await page.textContent("form [role=alert]")).includes(contractNo));

  await page.goto(BASE + "/");
  check("لوحة التحكم: إشغال 50% (وحدة من وحدتين في الازدهار)", await page.isVisible("text=50%"));
  check("لوحة التحكم: عقد نشط واحد", (await page.locator("p:has-text('العقود النشطة') >> xpath=../../p[contains(@class,'text-2xl')]").textContent()) === "1");

  await page.goto(BASE + "/units?status=OCCUPIED");
  check("بطاقة الوحدة المؤجرة تعرض اسم المستأجر", (await page.locator("[data-unit-card]").count()) === 1 && (await page.locator("[data-unit-card] >> text=شركة الريادة للتقنية").count()) === 1);
  await page.goto(BASE + "/contracts");
  check("بطاقات العقود مع شريط المدة والتصفية السريعة", (await page.locator("[data-contract-card]").count()) >= 1 && (await page.locator("[data-contract-card] [role=progressbar]").count()) >= 1 && (await page.isVisible("nav[aria-label='تصفية سريعة']")));
  await page.goto(BASE + "/tenants");
  check("بطاقات المستأجرين مع أزرار الحالة", (await page.locator("[data-tenant-card]").count()) >= 1 && (await page.isVisible("nav[aria-label='تصفية حسب الحالة']")));
  await page.goto(BASE + "/units?view=table&status=OCCUPIED");
  check("الوحدة 101 مؤجرة في قائمة الوحدات", (await page.locator("tbody tr").count()) === 1 && (await page.isVisible("td:has-text('مؤجرة')")));

  // نسخة الطباعة
  await page.goto(contractUrl.replace("/contracts/", "/print/contracts/"));
  check("نسخة الطباعة العربية تعرض رقم العقد والتنبيه القانوني", (await page.isVisible(`text=${contractNo}`)) && (await page.isVisible("text=لا تُعد توقيعًا إلكترونيًا معتمدًا")));
  await page.screenshot({ path: `${OUT}/p3-print.png`, fullPage: true });

  // التجديد ثم إلغاؤه ثم الإنهاء
  await page.goto(contractUrl);
  await page.click("button:has-text('إنشاء مسودة تجديد')");
  await page.waitForURL(/done=renew/);
  check("مسودة تجديد مرتبطة بالعقد السابق", await page.isVisible(`a:has-text('${contractNo}')`) && (await page.isVisible("text=تجديد للعقد")));
  await page.click("button:has-text('إلغاء العقد')");
  await page.fill("textarea[name=reason]", "سيُحدد السعر لاحقًا");
  await mainSubmit(page, "إلغاء العقد");
  await page.waitForURL(/done=cancel/);

  await page.goto(contractUrl);
  await page.click("button:has-text('إنهاء مبكر')");
  await page.fill("#exitDate", plusDays(today, 20));
  await page.check("input[value=CANCEL_FUTURE]");
  await page.fill("#term-reason", "انتقل العميل إلى مقر جديد بالاتفاق مع الإدارة");
  await page.click("button:has-text('تأكيد الإنهاء')");
  await page.waitForURL(/done=terminate/);
  const cancelled = await page.locator("tbody >> text=ملغى").count();
  check("الإنهاء المبكر يلغي الأقساط المستقبلية حسب الاختيار", cancelled >= 10, `ملغى: ${cancelled}`);
  check("يظهر تنبيه عدم الاسترداد", await page.isVisible("text=لا يُسترد أي مبلغ مدفوع"));

  // ── موظف مبيعات ──
  await page.goto(BASE + "/users/new");
  const sales = `sales-${Date.now()}@zaki.local`;
  await page.fill("#name", "موظف مبيعات الازدهار");
  await page.fill("#email", sales);
  await page.selectOption("#roleId", { label: "موظف المبيعات" });
  await page.fill("#password", "Sales-Temp-Pass-1");
  await page.getByLabel("الازدهار").check();
  await mainSubmit(page, "إنشاء المستخدم");
  await page.waitForSelector("text=تم إنشاء المستخدم بنجاح");
  await page.click("text=تسجيل الخروج");
  await login(page, sales, "Sales-Temp-Pass-1");
  await page.fill("#currentPassword", "Sales-Temp-Pass-1");
  await page.fill("#newPassword", "Sales-Real-Pass-22");
  await page.fill("#confirmPassword", "Sales-Real-Pass-22");
  await mainSubmit(page, "تغيير كلمة المرور");
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto(tenantUrl);
  check("موظف المبيعات لا يرى رقم الهوية", !(await page.isVisible("text=1000000001")) && (await page.isVisible("text=محجوب (بيانات حساسة)")));
  check("ولا يرى مستند الهوية الحساس", (await page.locator("text=يوجد 1 مستند حساس لا تملك صلاحية عرضه").count()) === 1);
  await page.goto(contractUrl);
  check("ولا يملك اعتماد أو إنهاء العقود", !(await page.isVisible("button:has-text('اعتماد العقد')")) && !(await page.isVisible("button:has-text('إنهاء مبكر')")));
  check("لا أخطاء في وحدة التحكم", errors.length === 0, errors.join(" | "));
  await ctx.close();

  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await login(m, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  for (const path of [tenantUrl.replace(BASE, ""), contractUrl.replace(BASE, ""), "/contracts", "/contracts/new", "/tenants"]) {
    await m.goto(BASE + path);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`لا تمرير أفقي على الجوال: ${path.slice(0, 22)}`, !overflow);
  }
  await m.goto(contractUrl);
  await m.screenshot({ path: `${OUT}/p3-mobile-contract.png`, fullPage: true });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
