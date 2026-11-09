// اختبار E2E بالمتصفح ضد نسخة إنتاجية تعمل (npm run build && npm start)
// الاستخدام: BASE_URL=http://localhost:3100 E2E_EMAIL=... E2E_PASSWORD=... E2E_NEW_PASSWORD=... node tests/e2e/smoke.mjs
import { createRequire } from "node:module";
// require يحترم NODE_PATH (لاستخدام Playwright مثبت عالميًا). محليًا: npm i -D playwright && npx playwright install chromium
const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const EMAIL = process.env.E2E_EMAIL;
const PASS = process.env.E2E_PASSWORD;
const NEW_PASS = process.env.E2E_NEW_PASSWORD;
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: "ar-SA" });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

  await page.goto(BASE + "/");
  check("الصفحات المحمية تعيد التوجيه لتسجيل الدخول", page.url().endsWith("/login"));
  check("الواجهة عربية RTL", (await page.getAttribute("html", "dir")) === "rtl" && (await page.getAttribute("html", "lang")) === "ar");
  await page.screenshot({ path: `${OUT}/01-login-desktop.png` });

  await page.fill("#email", EMAIL);
  await page.fill("#password", "Wrong-Password-1");
  await page.click("button[type=submit]");
  await page.waitForSelector("form [role=alert]");
  check("كلمة مرور خاطئة تعرض رسالة خطأ", (await page.textContent("form [role=alert]")).includes("غير صحيحة"));

  await page.fill("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/account/);
  check("كلمة المرور المؤقتة تفرض التغيير عند أول دخول", page.url().includes("/account"));
  await page.goto(BASE + "/users");
  check("لا يمكن تجاوز صفحة تغيير كلمة المرور", page.url().includes("/account"));

  await page.fill("#currentPassword", PASS);
  await page.fill("#newPassword", NEW_PASS);
  await page.fill("#confirmPassword", NEW_PASS);
  await page.click("main form button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname === "/");
  await page.waitForSelector("text=نسبة الإشغال");
  check("لوحة التحكم تظهر بعد تغيير كلمة المرور", true);
  check("حالة فارغة واضحة بدون أرقام وهمية", await page.isVisible("text=لا توجد وحدات مسجلة بعد"));
  check("الأقسام غير المنفذة معطلة وموسومة بالمرحلة", (await page.locator("[aria-disabled=true]").count()) >= 2);
  await page.screenshot({ path: `${OUT}/02-dashboard-desktop.png`, fullPage: true });

  // إنشاء مدير فرع مقيد بفرع واحد
  await page.goto(BASE + "/users/new");
  const bmEmail = `bm-${Date.now()}@zaki.local`;
  await page.fill("#name", "مدير فرع غرناطة");
  await page.fill("#email", bmEmail);
  await page.selectOption("#roleId", { label: "مدير الفرع" });
  await page.fill("#password", "Branch-Temp-Pass-1");
  await page.getByLabel("غرناطة مول").check();
  await page.screenshot({ path: `${OUT}/03-user-form.png`, fullPage: true });
  await page.click("main form button[type=submit]");
  await page.waitForSelector("text=تم إنشاء المستخدم بنجاح");
  check("إنشاء مستخدم من الواجهة", true);

  await page.goto(BASE + "/roles");
  check("مصفوفة الصلاحيات تعرض 7 أدوار", (await page.locator("thead th").count()) === 8);
  await page.goto(BASE + "/audit");
  check("سجل التدقيق يسجل إنشاء المستخدم", await page.isVisible("text=إنشاء مستخدم"));
  await page.screenshot({ path: `${OUT}/04-audit.png` });

  // تسجيل الخروج
  await page.click("text=تسجيل الخروج");
  await page.waitForURL(/\/login/);
  check("تسجيل الخروج", true);

  // دخول مدير الفرع والتحقق من القيود
  await page.fill("#email", bmEmail);
  await page.fill("#password", "Branch-Temp-Pass-1");
  await page.click("button[type=submit]");
  await page.waitForURL(/\/account/);
  await page.fill("#currentPassword", "Branch-Temp-Pass-1");
  await page.fill("#newPassword", "Branch-Real-Pass-22");
  await page.fill("#confirmPassword", "Branch-Real-Pass-22");
  await page.click("main form button[type=submit]");
  await page.waitForURL((u) => new URL(u).pathname === "/");
  check("قائمة مدير الفرع لا تعرض المستخدمين", (await page.locator("nav >> text=المستخدمون").count()) === 0);
  await page.goto(BASE + "/users");
  check("الوصول المباشر لصفحة المستخدمين محظور على الخادم", page.url().includes("/forbidden"));
  await page.goto(BASE + "/branches");
  const rows = await page.locator("tbody tr").count();
  check("مدير الفرع يرى فرعه فقط", rows === 1 && (await page.isVisible("text=غرناطة مول")), `rows=${rows}`);
  check("لا أخطاء في وحدة التحكم", consoleErrors.length === 0, consoleErrors.join(" | "));
  await ctx.close();

  // الجوال
  const mctx = await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" });
  const m = await mctx.newPage();
  await m.goto(BASE + "/login");
  await m.screenshot({ path: `${OUT}/05-login-mobile.png` });
  await m.fill("#email", bmEmail);
  await m.fill("#password", "Branch-Real-Pass-22");
  await m.click("button[type=submit]");
  await m.waitForSelector("text=نسبة الإشغال");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("لا تمرير أفقي على الجوال", !overflow);
  await m.click("button[aria-label='فتح القائمة']");
  check("قائمة الجوال تفتح", await m.isVisible("#mobile-sidebar"));
  await m.screenshot({ path: `${OUT}/06-mobile-menu.png` });
  await m.click("button[aria-label='إغلاق القائمة']");
  await m.screenshot({ path: `${OUT}/07-dashboard-mobile.png`, fullPage: true });
  await mctx.close();

  // ترويسات الأمان
  const res = await fetch(BASE + "/login");
  const h = res.headers;
  check("ترويسات الأمان (CSP, X-Frame-Options, nosniff)", !!h.get("content-security-policy") && h.get("x-frame-options") === "DENY" && h.get("x-content-type-options") === "nosniff");
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
