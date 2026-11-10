// اختبار E2E للمرحلة السادسة: الأمان والتحقق الثنائي. يُشغَّل والخادم بفرض التحقق الثنائي (الافتراضي في الإنتاج).
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`);
};
// TOTP (RFC 6238) مستقل عن كود التطبيق للتحقق المتقاطع
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32dec = (s) => { let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const totp = (secret, step) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = createHmac("sha1", b32dec(secret)).update(b).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const step = () => Math.floor(Date.now() / 30000);

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "ar-SA" });
  const page = await ctx.newPage();
  const errors = [];
  const dialogs = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

  // ── الوصول بدون جلسة ──
  for (const [path, expect] of [["/api/documents/00000000-0000-4000-8000-000000000000", 401], ["/api/reports/branches", 401]]) {
    const r = await page.request.get(BASE + path, { maxRedirects: 0 });
    check(`بدون جلسة: ${path.split("/").slice(0, 3).join("/")} مرفوض`, r.status() === expect, String(r.status()));
  }
  const cron = await page.request.post(BASE + "/api/cron/daily");
  check("نقطة المهمة اليومية مغلقة بدون سر", [401, 404].includes(cron.status()), String(cron.status()));

  // ── كوكي الجلسة ──
  await page.goto(BASE + "/login");
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  const [resp] = await Promise.all([page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/login")), page.click("button[type=submit]")]);
  const sc = (await resp.headerValue("set-cookie")) ?? "";
  check("كوكي الجلسة: __Host- و HttpOnly و Secure و SameSite=Lax", /__Host-zaki_session=/.test(sc) && /HttpOnly/i.test(sc) && /Secure/i.test(sc) && /SameSite=lax/i.test(sc), sc.replace(/=[^;]+;/, "=…;").slice(0, 90));

  // ── فرض التحقق الثنائي على مسؤول النظام ──
  await page.waitForURL(/\/account\/mfa\?required=1/);
  check("مسؤول النظام يُحوَّل إجباريًا لتفعيل التحقق الثنائي", true);
  await page.goto(BASE + "/users");
  check("لا يمكن تجاوز صفحة التفعيل", page.url().includes("/account/mfa"));
  await page.click("button:has-text('بدء التفعيل')");
  await page.waitForSelector("[data-testid=mfa-secret]");
  check("رمز QR يظهر", (await page.locator("[aria-label='رمز QR للتفعيل'] svg").count()) === 1);
  const secret = (await page.textContent("[data-testid=mfa-secret]")).trim();
  await page.fill("#code", "000000");
  await page.click("button:has-text('تأكيد التفعيل')");
  await page.waitForSelector("form [role=alert]");
  check("رمز خاطئ عند التفعيل مرفوض", (await page.textContent("form [role=alert]")).includes("غير صحيح"));
  const enrollStep = step();
  await page.fill("#code", totp(secret, enrollStep));
  await page.click("button:has-text('تأكيد التفعيل')");
  await page.waitForSelector("[data-testid=recovery-codes]");
  const codes = await page.locator("[data-testid=recovery-codes] li").allTextContents();
  check("8 رموز استرداد تُعرض مرة واحدة", codes.length === 8);
  await page.screenshot({ path: `${OUT}/p6-mfa-enrolled.png`, fullPage: true });
  await page.goto(BASE + "/");
  check("بعد التفعيل يعمل النظام", await page.isVisible("text=نسبة الإشغال"));
  await page.click("text=تسجيل الخروج");

  // ── الدخول بالمرحلتين ──
  await page.fill("#email", process.env.E2E_EMAIL);
  await page.fill("#password", process.env.E2E_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/login\/mfa/);
  check("كلمة المرور الصحيحة تطلب رمز التحقق", true);
  await page.goto(BASE + "/");
  check("لا جلسة قبل إدخال الرمز", page.url().endsWith("/login"));
  await page.goBack();
  await page.goto(BASE + "/login/mfa");
  await page.fill("#code", "123456");
  await page.click("button:has-text('تحقق')");
  await page.waitForSelector("form [role=alert]");
  check("رمز خاطئ: يظهر عدد المحاولات المتبقية", (await page.textContent("form [role=alert]")).includes("المتبقية: 4"));
  await page.screenshot({ path: `${OUT}/p6-mfa-login.png` });
  // الخطوة المستخدمة في التفعيل لا تُقبل مرة أخرى؛ نستخدم الخطوة التالية (ضمن نافذة ±1)
  const s = Math.max(step(), enrollStep + 1);
  await page.fill("#code", totp(secret, s));
  await page.click("button:has-text('تحقق')");
  await page.waitForURL((u) => u.pathname === "/");
  check("الرمز الصحيح يكمل الدخول", await page.isVisible("text=نسبة الإشغال"));

  // ── XSS ──
  const evil = `<img src=x onerror=alert('xss1')><script>alert('xss2')</script>`;
  await page.goto(BASE + "/tenants/new");
  await page.fill("#name", evil);
  await page.selectOption("#primaryBranchId", { index: 1 });
  await page.click("main form button[type=submit]:has-text('حفظ')");
  await page.waitForURL(/\/tenants\/[0-9a-f-]{36}/);
  await page.waitForTimeout(500);
  check("XSS: الاسم يظهر كنص ولا يُنفَّذ", dialogs.length === 0 && (await page.textContent("h1")).includes("<script>"), dialogs.join(","));
  await page.goto(BASE + "/tenants?q=" + encodeURIComponent("<script>"));
  await page.waitForTimeout(300);
  check("XSS: في القوائم أيضًا", dialogs.length === 0);

  // ── حقن SQL ──
  for (const q of ["' OR 1=1 --", "'; DROP TABLE tenants; --"]) {
    await page.goto(BASE + "/tenants?q=" + encodeURIComponent(q));
    check(`حقن SQL في البحث بلا أثر: ${q.slice(0, 12)}`, await page.isVisible("text=لا توجد نتائج"));
  }
  const after = await page.request.get(BASE + "/tenants");
  check("جدول المستأجرين سليم بعد محاولات الحقن", after.status() === 200);

  // ── CSRF: إعادة إرسال إجراء خادم من أصل آخر ──
  await page.goto(BASE + "/account");
  let captured = null;
  await page.route("**/account", async (route) => {
    const r = route.request();
    if (r.method() === "POST") captured = { headers: r.headers(), body: r.postDataBuffer() };
    await route.continue();
  });
  await page.fill("#currentPassword", "wrong-password-x1");
  await page.fill("#newPassword", "Another-Pass-998");
  await page.fill("#confirmPassword", "Another-Pass-998");
  await page.click("main form button[type=submit]");
  await page.waitForSelector("form [role=alert]");
  await page.unroute("**/account");
  const forged = await page.request.post(BASE + "/account", {
    headers: { ...captured.headers, origin: "https://evil.example", host: new URL(BASE).host },
    data: captured.body,
    failOnStatusCode: false,
  });
  const fb = await forged.text();
  check("CSRF: إجراء من أصل آخر مرفوض", forged.status() >= 400 || !fb.includes("كلمة المرور الحالية غير صحيحة"), String(forged.status()));

  // ── ترويسات الأمان و CSP ──
  const h = (await page.request.get(BASE + "/login")).headers();
  check("CSP بـ nonce و strict-dynamic بلا unsafe-inline للسكربتات", /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(h["content-security-policy"] ?? "") && !/script-src[^;]*unsafe-inline/.test(h["content-security-policy"]));
  check("HSTS و X-Frame-Options و COOP", !!h["strict-transport-security"] && h["x-frame-options"] === "DENY" && h["cross-origin-opener-policy"] === "same-origin");
  check("لا أخطاء في وحدة التحكم (بما فيها انتهاكات CSP)", errors.length === 0, errors.join(" | ").slice(0, 200));
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
