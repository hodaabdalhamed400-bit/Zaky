// اختبار E2E للمجسم ثلاثي الأبعاد ومحرر المخطط (يُشغَّل بعد bookings.mjs: فرع الازدهار فيه وحدات).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium, devices } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok }); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
// WebGL بلا بطاقة رسوميات في بيئة الاختبار
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

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
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await login(page);

  await page.goto(BASE + "/branches?q=" + encodeURIComponent("الازدهار"));
  await page.click("[data-branch-card]");
  await page.waitForURL(/\/branches\/[0-9a-f-]{36}$/);
  const branchUrl = page.url();
  await page.click("a:has-text('المجسم 3D')");
  await page.waitForURL(/\/3d$/);
  await page.waitForSelector("[data-branch-3d] canvas", { timeout: 20000 });
  await page.waitForTimeout(3500);
  check("المجسم يُبنى في لوحة رسم ثلاثية الأبعاد", (await page.locator("[data-branch-3d] canvas").count()) === 1);
  check("أسماء الوحدات تظهر فوق المجسم", (await page.locator("[data-branch-3d] >> text=101").count()) >= 1);
  check("دليل الألوان مع الأعداد", await page.isVisible("ul[aria-label='دليل الألوان']"));
  check("تنبيه الترتيب التلقائي قبل رسم المخطط", await page.isVisible("text=مرتبة تلقائيًا"));
  const box = await page.locator("[data-branch-3d]").boundingBox();
  let tip = false;
  for (const [fx, fy] of [[0.5, 0.5], [0.45, 0.55], [0.55, 0.45], [0.5, 0.6], [0.6, 0.55], [0.4, 0.5]]) {
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(250);
    if (await page.locator("[role=tooltip]").count()) { tip = true; break; }
  }
  check("المرور على مكتب يعرض بطاقة تفاصيله", tip);
  await page.screenshot({ path: `${OUT}/b3d-scene.png` });
  check("العرض النهاري افتراضي", (await page.getAttribute("[data-branch-3d]", "data-theme")) === "day");
  await page.click("[data-theme-toggle]");
  await page.waitForSelector("[data-branch-3d][data-theme=night] canvas", { timeout: 20000 });
  await page.waitForTimeout(2500);
  check("التبديل إلى العرض الليلي يعيد بناء المجسم", (await page.locator("[data-branch-3d] canvas").count()) === 1);
  await page.screenshot({ path: `${OUT}/b3d-night.png` });
  await page.click("[data-theme-toggle]");
  await page.waitForSelector("[data-branch-3d][data-theme=day] canvas", { timeout: 20000 });

  await page.click("a:has-text('محرر المخطط')");
  await page.waitForURL(/\/layout$/);
  const rect = page.locator("[data-layout-unit='101'] rect");
  await rect.waitFor();
  const r0 = await rect.boundingBox();
  await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
  await page.mouse.down();
  await page.mouse.move(r0.x + r0.width / 2 + 120, r0.y + r0.height / 2 + 80, { steps: 8 });
  await page.mouse.up();
  const x1 = await rect.getAttribute("x");
  check("سحب المكتب يحركه على المخطط", Number(x1) > 2, `x=${x1}`);
  await page.click("form button[type=submit]:has-text('حفظ المخطط')");
  await page.waitForSelector("text=تم حفظ مخطط");
  check("حفظ المخطط", true);
  await page.reload();
  const x2 = await page.locator("[data-layout-unit='101'] rect").getAttribute("x");
  check("المكان المحفوظ يبقى بعد إعادة التحميل", x2 === x1, `${x1} → ${x2}`);
  await page.goto(branchUrl + "/3d");
  await page.waitForSelector("[data-branch-3d] canvas", { timeout: 20000 });
  check("بعد الحفظ يختفي تنبيه الترتيب التلقائي", !(await page.isVisible("text=المكاتب مرتبة تلقائيًا")));
  await page.goto(BASE + "/audit");
  check("تعديل المخطط في سجل التدقيق", await page.isVisible("text=تعديل مخطط الفرع"));
  check("لا أخطاء في وحدة التحكم", errors.length === 0, errors.join(" | ").slice(0, 300));

  const m = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar-SA" })).newPage();
  await login(m);
  for (const path of [branchUrl.replace(BASE, "") + "/3d", branchUrl.replace(BASE, "") + "/layout"]) {
    await m.goto(BASE + path);
    await m.waitForTimeout(1500);
    check(`لا تمرير أفقي على الجوال: ${path.split("/").pop()}`, !(await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
  }
  await m.screenshot({ path: `${OUT}/b3d-mobile.png` });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
