// اختبار E2E للمرحلة الثانية (الفروع والوحدات) ضد نسخة إنتاجية تعمل.
// يتطلب حساب مسؤول نظام (كلمة مرور غير مؤقتة) في قاعدة تطوير بها الفروع المزروعة ولا وحدات فيها.
// BASE_URL=... E2E_EMAIL=... E2E_PASSWORD=... node tests/e2e/phase2.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};
// ينتظر تغيّر الرابط بعد "حفظ وإضافة أخرى" (رسالة النجاح قد تكون ظاهرة مسبقًا)
async function saveAndAddAnother(page) {
  const before = page.url();
  await page.click("button[name=another]");
  await page.waitForURL((u) => u.toString() !== before && u.toString().includes("added="));
  await page.waitForSelector("text=تم حفظ الوحدة");
}
const submit = (page) => page.click("main form button[type=submit]:not([name=another])");

async function login(page, email, password) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
}

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ar-SA" });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("dialog", (d) => d.accept());

  await login(page, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  await page.waitForURL((u) => new URL(u).pathname === "/");

  // ── الفروع ──
  await page.goto(BASE + "/branches");
  check("قائمة الفروع تعرض 11 فرعًا (بطاقات)", (await page.locator("[data-branch-card]").count()) === 11);
  check("تقسيم الفروع: عاملة وقيد التجهيز", (await page.isVisible("h2:has-text('الفروع العاملة')")) && (await page.isVisible("h2:has-text('قيد التجهيز')")));
  await page.goto(BASE + "/branches?view=table");
  check("عرض الجدول يعرض 11 فرعًا", (await page.locator("tbody tr").count()) === 11);
  await page.goto(BASE + "/branches?q=" + encodeURIComponent("تبوك"));
  check("البحث في الفروع", (await page.locator("[data-branch-card]").count()) === 1);
  await page.goto(BASE + "/branches");
  await page.click("text=الازدهار");
  await page.waitForURL(/\/branches\/[0-9a-f-]{36}$/);
  const branchUrl = page.url();
  const izdId = branchUrl.split("/").pop();

  await page.fill("#floor-name", "الدور الأول");
  await page.fill("#floor-level", "1");
  await page.click("text=إضافة");
  await page.waitForSelector("text=تمت إضافة الدور");
  check("إضافة دور للفرع", await page.isVisible("li:has-text('الدور الأول')"));

  await page.goto(branchUrl + "/edit");
  await page.fill("#mapUrl", "javascript:alert(1)");
  await submit(page);
  await page.waitForSelector("form [role=alert]");
  check("رفض رابط خريطة غير آمن", (await page.textContent("form [role=alert]")).includes("https"));
  await page.fill("#address", "حي الازدهار، طريق الملك عبدالعزيز");
  await page.fill("#mapUrl", "https://maps.google.com/?q=24.77,46.70");
  await submit(page);
  await page.waitForSelector("text=تم حفظ بيانات الفرع");
  check("تعديل بيانات الفرع وعرض رابط الخريطة", await page.isVisible("a:has-text('فتح الخريطة')"));

  // ── الوحدات ──
  await page.goto(`${BASE}/units/new?branchId=${izdId}`);
  await page.selectOption("#unitTypeId", { label: "مكتب خاص" });
  await page.selectOption("#floorId", { label: "الدور الأول" });
  await page.fill("#code", "101");
  await page.fill("#areaSqm", "20");
  await page.fill("#capacity", "2");
  await page.fill("#basePrice", "2,500");
  await saveAndAddAnother(page);
  check("حفظ وإضافة أخرى يحتفظ بالفرع", (await page.inputValue("#branchId")) === izdId);
  await page.selectOption("#unitTypeId", { label: "مكتب خاص" });
  await page.fill("#code", "102");
  await page.fill("#areaSqm", "30");
  await page.fill("#basePrice", "3500");
  await saveAndAddAnother(page);
  await page.selectOption("#unitTypeId", { label: "مكتب مشترك" });
  check("حقل السعة يتحول إلى عدد المقاعد للوحدة المشتركة", await page.isVisible("label:has-text('عدد المقاعد')"));
  await page.fill("#code", "S1");
  await page.fill("#areaSqm", "60");
  await page.fill("#capacity", "12");
  await page.fill("#basePrice", "800");
  await submit(page);
  await page.waitForURL(/\/units\/[0-9a-f-]{36}\?saved=1/);
  check("إنشاء وحدة مشتركة وعرض تفاصيلها", await page.isVisible("text=0 مؤجرة من 12"));

  await page.goto(`${BASE}/units/new?branchId=${izdId}`);
  await page.selectOption("#unitTypeId", { label: "مكتب خاص" });
  await page.fill("#code", "101");
  await page.fill("#basePrice", "100");
  await submit(page);
  await page.waitForSelector("form [role=alert]");
  check("منع تكرار رقم الوحدة في نفس الفرع", (await page.textContent("form [role=alert]")).includes("مستخدم"));

  await page.goto(BASE + "/units");
  check("قائمة الوحدات (بطاقات) تعرض 3 وحدات مع شريط الحالات", (await page.locator("[data-unit-card]").count()) === 3 && (await page.isVisible("nav[aria-label='تصفية حسب الحالة']")));
  await page.goto(BASE + "/units?view=table");
  check("قائمة الوحدات تعرض 3 وحدات", (await page.locator("tbody tr").count()) === 3);
  await page.screenshot({ path: `${OUT}/p2-units-table.png`, fullPage: true });
  await page.fill("#q", "10");
  await page.click("text=تطبيق");
  await page.waitForURL(/q=10/);
  check("البحث برقم الوحدة", (await page.locator("tbody tr").count()) === 2);
  await page.goto(BASE + "/units?view=table&minPrice=1000&maxPrice=3000");
  check("التصفية بالسعر", (await page.locator("tbody tr").count()) === 1);
  await page.goto(BASE + "/units?status=FREE&view=cards");
  check("عرض البطاقات وفلتر المتاحة فعليًا", (await page.locator("[data-unit-card]").count()) === 3);
  await page.screenshot({ path: `${OUT}/p2-units-cards.png`, fullPage: true });

  await page.goto(BASE + "/units?view=table&q=102");
  await page.click("tbody >> text=102");
  await page.click("text=أرشفة الوحدة");
  await page.waitForSelector("text=تمت أرشفة الوحدة");
  await page.goto(BASE + "/units?view=table");
  check("الوحدة المؤرشفة تختفي من القائمة", (await page.locator("tbody tr").count()) === 2);
  await page.goto(BASE + "/units?view=table&archived=1");
  check("وتظهر في المؤرشفة", (await page.locator("tbody tr").count()) === 1);
  await page.screenshot({ path: `${OUT}/p2-unit-detail.png`, fullPage: true });

  await page.goto(branchUrl);
  check("إشغال الفرع يُحسب من الوحدات (0 من 2 وحدة)", await page.isVisible("text=0 من 2 وحدة"));
  check("الإشغال حسب المساحة (0 من 80 م²)", await page.isVisible("text=0 من 80 م²"));
  await page.screenshot({ path: `${OUT}/p2-branch-detail.png`, fullPage: true });

  await page.goto(BASE + "/units/types");
  await page.fill("#type-name", "مكتب افتراضي");
  await page.selectOption("#type-mode", "SHARED");
  await page.click("button:has-text('إضافة النوع')");
  await page.waitForSelector("text=تمت إضافة النوع");
  check("إضافة نوع وحدة مخصص", await page.isVisible("td:has-text('مكتب افتراضي')"));

  await page.goto(BASE + "/audit");
  check("سجل التدقيق يسجل عمليات الوحدات", await page.isVisible("text=أرشفة وحدة") && await page.isVisible("text=إضافة وحدة"));

  // ── مدير فرع النفل ──
  await page.goto(BASE + "/users/new");
  const bm = `nfl-${Date.now()}@zaki.local`;
  await page.fill("#name", "مدير النفل");
  await page.fill("#email", bm);
  await page.selectOption("#roleId", { label: "مدير الفرع" });
  await page.fill("#password", "Nafl-Temp-Pass-1");
  await page.getByLabel("النفل").check();
  await submit(page);
  await page.waitForSelector("text=تم إنشاء المستخدم بنجاح");
  await page.click("text=تسجيل الخروج");
  await page.waitForURL(/\/login/);
  await login(page, bm, "Nafl-Temp-Pass-1");
  await page.waitForURL(/\/account/);
  await page.fill("#currentPassword", "Nafl-Temp-Pass-1");
  await page.fill("#newPassword", "Nafl-Real-Pass-22");
  await page.fill("#confirmPassword", "Nafl-Real-Pass-22");
  await submit(page);
  await page.waitForURL((u) => new URL(u).pathname === "/");

  await page.goto(BASE + "/units/new");
  const opts = await page.locator("#branchId option:not([disabled])").allTextContents();
  check("مدير الفرع يضيف وحدات لفرعه فقط", opts.length === 1 && opts[0] === "النفل", opts.join(","));
  await page.goto(BASE + "/units");
  check("مدير الفرع لا يرى وحدات الازدهار", await page.isVisible("text=لا توجد وحدات بعد"));
  // قبل زيارة صفحة 404 المتعمدة (المتصفح يسجلها كخطأ تحميل)
  check("لا أخطاء في وحدة التحكم", consoleErrors.length === 0, consoleErrors.join(" | "));
  await page.goto(branchUrl);
  check("فتح فرع آخر مباشرة يعطي 404", await page.isVisible("text=الصفحة غير موجودة"));
  await page.goto(BASE + "/branches/new");
  check("إنشاء فرع محظور على مدير الفرع", page.url().includes("/forbidden"));
  await ctx.close();

  // ── الجوال ──
  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await login(m, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  await m.waitForURL((u) => new URL(u).pathname === "/");
  for (const path of ["/units?view=cards", "/units", "/branches", branchUrl.replace(BASE, "")]) {
    await m.goto(BASE + path);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`لا تمرير أفقي على الجوال: ${path.split("?")[0].slice(0, 20)}`, !overflow);
  }
  await m.goto(BASE + "/units?view=cards");
  await m.screenshot({ path: `${OUT}/p2-mobile-cards.png`, fullPage: true });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
