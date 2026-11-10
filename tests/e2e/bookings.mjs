// اختبار E2E لوحدة حجوزات القاعات. يُشغَّل بعد phase5.mjs (يحتاج مستأجرًا بعقد نشط في الازدهار).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const plus = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const DAY = plus(today, 1);
const mainSubmit = (page, text) => page.click(`main form button[type=submit]:has-text("${text}")`);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-SA" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/login");
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL((u) => u.pathname === "/");

  // قاعة بالساعة
  await page.goto(BASE + "/units/new");
  await page.selectOption("#branchId", { label: "الازدهار" });
  await page.selectOption("#unitTypeId", { label: "قاعة اجتماعات" });
  await page.fill("#code", "قاعة 1");
  await page.fill("#capacity", "8");
  await page.fill("#basePrice", "100");
  await page.selectOption("#pricingCycle", "HOUR");
  await page.click("main form button[type=submit]:not([name=another])");
  await page.waitForURL(/\/units\/[0-9a-f-]{36}/);

  await page.goto(`${BASE}/bookings?date=${DAY}`);
  check("جدول الحجوزات يعرض القاعة وساعات 8–22", (await page.isVisible("th:has-text('قاعة 1')")) && (await page.locator("thead th").count()) === 15);
  await page.click("a[aria-label='حجز قاعة 1 الساعة 10:00']");
  await page.waitForURL(/\/bookings\/new\?/);
  check("الضغط على الخانة يملأ القاعة والوقت", (await page.inputValue("#startHour")) === "10");
  await page.selectOption("#hours", "3");
  await page.selectOption("#tenantId", { label: "شركة الريادة للتقنية — 0551112233" });
  await mainSubmit(page, "تأكيد الحجز");
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}\?done=created/);
  const tenantBooking = page.url().split("?")[0];
  check("المستأجر: ساعتان مجانيتان + ساعة بـ 100 ر.س", (await page.isVisible("text=2 / 1")) && (await page.isVisible("text=عليه 100.00 ر.س")));

  await page.goto(`${BASE}/bookings/new?date=${DAY}&startHour=11`);
  await page.selectOption("#unitId", { label: "قاعة 1 — الازدهار" });
  await page.check("input[value=VISITOR]");
  await page.fill("#visitorName", "زائر تجريبي");
  await mainSubmit(page, "تأكيد الحجز");
  await page.waitForSelector("form [role=alert]");
  check("منع التداخل في نفس القاعة", (await page.textContent("form [role=alert]")).includes("محجوزة"));
  await page.selectOption("#startHour", "14");
  await page.selectOption("#hours", "2");
  await mainSubmit(page, "تأكيد الحجز");
  await page.waitForURL(/done=created/);
  check("الزائر يدفع من أول ساعة (200 ر.س)", await page.isVisible("text=عليه 200.00 ر.س"));

  await page.selectOption("#bp-method", "CASH");
  await mainSubmit(page, "تسجيل الدفعة");
  await page.waitForURL(/\/finance\/payments\/.*done=recorded/);
  await page.click("button:has-text('اعتماد وإصدار إيصال')");
  await page.waitForURL(/done=approve/);
  check("دفعة الحجز تُعتمد بإيصال من تسلسل الفرع", /RC-IZD-\d{4}-\d{5}/.test(await page.textContent("h1")));
  check("الإيصال يذكر الزائر", await page.isVisible("text=زائر تجريبي (زائر)"));

  await page.goto(`${BASE}/bookings?date=${DAY}`);
  check("الجدول يعرض الحجزين بلونيهما", (await page.locator("tbody a.bg-amber-100").count()) === 1 && (await page.locator("tbody a.bg-emerald-100").count()) === 1);
  await page.screenshot({ path: `${OUT}/bk-board.png`, fullPage: true });

  await page.goto(tenantBooking);
  await page.click("button:has-text('إلغاء الحجز')");
  await page.fill("textarea[name=reason]", "العميل غيّر الموعد");
  await mainSubmit(page, "إلغاء الحجز");
  await page.waitForURL(/done=cancelled/);
  check("إلغاء حجز غير مسدد", await page.isVisible("text=تم إلغاء الحجز"));
  check("لا أخطاء في وحدة التحكم", errors.length === 0, errors.join(" | "));
  await ctx.close();

  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await m.goto(BASE + "/login");
  await m.fill("#email", process.env.E2E_EMAIL);
  await m.fill("#password", process.env.E2E_PASSWORD);
  await m.click("button[type=submit]");
  await m.waitForURL((u) => u.pathname === "/");
  for (const path of [`/bookings?date=${DAY}`, "/bookings/new"]) {
    await m.goto(BASE + path);
    check(`لا تمرير أفقي للصفحة على الجوال: ${path.split("?")[0]}`, !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
