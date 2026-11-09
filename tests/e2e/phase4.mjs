// اختبار E2E للمرحلة الرابعة (التحصيل). يُشغَّل بعد phase3.mjs على نفس القاعدة.
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
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const minusMonths = (d, n) => { const [y, m, dd] = d.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 - n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(dd, last)).padStart(2, "0")}`; };
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

  // عقد على الوحدة المشتركة يبدأ قبل شهرين: قسطان متأخران وقسط اليوم
  await page.goto(BASE + "/contracts/new");
  await page.selectOption("#branchId", { label: "الازدهار" });
  await page.selectOption("#tenantId", { label: "شركة الريادة للتقنية — 0551112233" });
  await page.fill("#startDate", minusMonths(today, 2));
  await page.selectOption("#pick-unit", { label: "S1 — مكتب مشترك" });
  await page.click("button:has-text('إضافة الوحدة')");
  await page.fill("#seats-0", "3");
  await page.fill("#price-0", "2400");
  await mainSubmit(page, "حفظ كمسودة");
  await page.waitForURL(/done=created/);
  const contractUrl = page.url().split("?")[0];
  await page.click("button:has-text('إرسال للاعتماد')");
  await page.waitForURL(/done=submit/);
  await page.click("button:has-text('اعتماد العقد')");
  await page.waitForURL(/done=approve/);
  check("عقد بأقساط متأخرة يظهرها بعلامة متأخر", (await page.locator("tbody >> text=متأخر").count()) === 2);

  await page.goto(BASE + "/finance/overdue");
  check("تقرير المتأخرات: 4,800 ر.س على العقد", await page.isVisible("text=4,800.00 ر.س"));

  // تسجيل دفعة: توزيع على الأقدم
  await page.goto(contractUrl);
  await page.click("a:has-text('تسجيل دفعة')");
  await page.waitForURL(/\/finance\/payments\/new\?contractId=/);
  await page.fill("#amount", "3000");
  await page.click("button:has-text('توزيع على الأقدم أولًا')");
  check("التوزيع على الأقدم: 2400 ثم 600", await page.isVisible("text=مطابق ✓"));
  await page.fill("#referenceNo", "TRX-1001");
  await page.screenshot({ path: `${OUT}/p4-payment-form.png`, fullPage: true });
  await mainSubmit(page, "تسجيل الدفعة");
  await page.waitForURL(/done=recorded/);
  const paymentUrl = page.url().split("?")[0];
  check("الدفعة بانتظار المراجعة بلا إيصال", await page.isVisible("h1:has-text('دفعة بانتظار المراجعة')"));

  await page.goto(BASE + "/finance");
  check("تنبيه الدفعات المعلقة، والمحصّل لا يشملها", (await page.isVisible("text=يوجد 1 دفعة بانتظار المراجعة")) && (await page.isVisible("text=3,000.00 ر.س")));

  // منع التكرار والدفع الزائد
  await page.goto(contractUrl.replace("/contracts/", "/finance/payments/new?contractId="));
  await page.fill("#amount", "100");
  await page.fill("input[id^=a-] >> nth=2", "100");
  await page.fill("#referenceNo", "trx-1001");
  await mainSubmit(page, "تسجيل الدفعة");
  await page.waitForSelector("form [role=alert]");
  check("منع تسجيل نفس رقم الحوالة مرتين", (await page.textContent("form [role=alert]")).includes("مسجلة مسبقًا"));
  await page.fill("#referenceNo", "TRX-2002");
  await page.fill("#amount", "50");
  check("الواجهة تُظهر عدم التطابق قبل الإرسال", await page.isVisible("text=الفرق: -50.00"));
  await mainSubmit(page, "تسجيل الدفعة");
  await page.waitForFunction(() => document.querySelector("form [role=alert]")?.textContent?.includes("لا يوجد دفع زائد"));
  check("الخادم يرفض الدفع الزائد", true);

  // الاعتماد والإيصال
  await page.goto(paymentUrl);
  await page.click("button:has-text('اعتماد وإصدار إيصال')");
  await page.waitForURL(/done=approve/);
  const h1 = await page.textContent("h1");
  check("إيصال برقم من تسلسل الفرع RC-IZD-السنة-00001", /RC-IZD-\d{4}-00001/.test(h1), h1);
  await page.goto(paymentUrl.replace("/finance/payments/", "/print/receipts/"));
  check("الإيصال المطبوع يوضح أنه ليس فاتورة ضريبية", await page.isVisible("text=ليس فاتورة ضريبية"));
  await page.screenshot({ path: `${OUT}/p4-receipt.png`, fullPage: true });

  await page.goto(contractUrl);
  check("القسط الأول مسدد والثاني جزئي", (await page.locator("tbody >> text=مسدد جزئيًا").count()) === 1 && (await page.locator("td >> span:text-is('مسدد')").count()) === 1);
  await page.goto(BASE + "/finance");
  check("المحصّل في الشهر بعد الاعتماد 3,000", (await page.locator("p:has-text('المحصّل في الشهر') >> xpath=../../p[contains(@class,'text-2xl')]").textContent()).includes("3,000.00"));
  await page.screenshot({ path: `${OUT}/p4-finance.png`, fullPage: true });

  // العكس ثم التسوية
  await page.goto(paymentUrl);
  await page.click("button:has-text('عكس الدفعة (تصحيح)')");
  await page.fill("textarea[name=reason]", "الحوالة لم تصل للحساب البنكي");
  await mainSubmit(page, "عكس الدفعة (تصحيح)");
  await page.waitForURL(/done=reverse/);
  check("العكس: الدفعة معكوسة والإيصال محفوظ", (await page.isVisible("text=معكوسة")) && (await page.textContent("h1")).includes("RC-IZD"));
  await page.goto(contractUrl);
  check("بعد العكس: لا أقساط مسددة", (await page.locator("tbody >> text=مسدد جزئيًا").count()) === 0);
  await page.selectOption("#adj-s", { index: 1 });
  await page.selectOption("#adj-t", "DISCOUNT");
  await page.fill("#adj-a", "400");
  await page.fill("#adj-r", "خصم بموافقة الإدارة لظروف العميل");
  await mainSubmit(page, "تسجيل التسوية");
  await page.waitForSelector("text=تم تسجيل التسوية");
  check("تسوية خصم على قسط", (await page.locator("tbody >> text=مسدد جزئيًا").count()) === 1);

  await page.goto(BASE + "/audit");
  check("سجل التدقيق: تسجيل واعتماد وعكس وتسوية", (await page.isVisible("text=عكس دفعة")) && (await page.isVisible("text=اعتماد دفعة وإصدار إيصال")) && (await page.isVisible("text=تسوية على قسط")));
  check("لا أخطاء في وحدة التحكم", errors.length === 0, errors.join(" | "));
  await ctx.close();

  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await login(m, process.env.E2E_EMAIL, process.env.E2E_PASSWORD);
  for (const path of ["/finance", "/finance/payments", "/finance/overdue", paymentUrl.replace(BASE, ""), contractUrl.replace("/contracts/", "/finance/payments/new?contractId=").replace(BASE, "")]) {
    await m.goto(BASE + path);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`لا تمرير أفقي على الجوال: ${path.slice(0, 26)}`, !overflow);
  }
  await m.goto(BASE + "/finance");
  await m.screenshot({ path: `${OUT}/p4-mobile-finance.png`, fullPage: true });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
