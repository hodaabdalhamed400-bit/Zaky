import { describe, expect, it } from "vitest";
import { prisma, makeUser, uniqueEmail } from "./helpers";
import { isCloudflareIp, resolveClientIp } from "@/lib/client-ip";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { login, LOGIN_LIMITS } from "@/services/auth.service";
import { requestPasswordReset, RESET_LIMITS } from "@/services/password-reset.service";
import { getSharedTenantView } from "@/services/tenant-share.service";

describe("عنوان IP الحقيقي خلف Cloudflare", () => {
  it("يأخذ CF-Connecting-IP فقط إذا كان الاتصال فعلًا من Cloudflare", () => {
    expect(isCloudflareIp("172.68.10.5")).toBe(true);
    expect(isCloudflareIp("8.8.8.8")).toBe(false);
    // عبر Cloudflare: Render يضيف IP Cloudflare في آخر السلسلة
    expect(resolveClientIp({ xff: "5.6.7.8, 172.68.10.5", realIp: null, cfConnectingIp: "5.6.7.8" }, 1)).toBe("5.6.7.8");
    // دخول مباشر على Render مع ترويسة مزوّرة: تُتجاهل
    expect(resolveClientIp({ xff: "9.9.9.9", realIp: null, cfConnectingIp: "1.2.3.4" }, 1)).toBe("9.9.9.9");
    expect(resolveClientIp({ xff: "1.2.3.4, 9.9.9.9", realIp: null, cfConnectingIp: null }, 1)).toBe("9.9.9.9");
  });
});

describe("Rate limiting", () => {
  it("محدد المعدل يمنع بعد الحد ويرجع بعد النافذة", () => {
    resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 1000, t + i)).toBe(true);
    expect(rateLimit("k", 3, 1000, t + 10)).toBe(false);
    expect(rateLimit("k", 3, 1000, t + 2000)).toBe(true);
  });

  it("«نسيت كلمة المرور» محدودة لكل IP حتى لبريد غير موجود", async () => {
    resetRateLimits();
    const ip = "203.0.113.77";
    for (let i = 0; i < RESET_LIMITS.perIpPerHour; i++) {
      const r = await requestPasswordReset(prisma, uniqueEmail("ghost"), { ip });
      expect(r.ok).toBe(true);
    }
    const blocked = await requestPasswordReset(prisma, uniqueEmail("ghost"), { ip });
    expect(blocked.ok).toBe(false);
  });

  it("صفحة المستأجر ترفض رموزًا بصيغة غير صالحة دون استعلام", async () => {
    expect(await getSharedTenantView(prisma, "'; DROP TABLE tenants; --xxxxxxxxx")).toBeNull();
    expect(await getSharedTenantView(prisma, "<script>alert(1)</script>xxxxxxxx")).toBeNull();
  });
});

describe("مراقبة النشاط المشبوه", () => {
  it("قفل الحساب بعد المحاولات الفاشلة يرسل تنبيهًا للمسؤول ويُسجَّل في التدقيق", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    for (let i = 0; i < LOGIN_LIMITS.maxFailuresPerEmail; i++) await login(prisma, { email: user.email, password: "Wrong-pass-123" }, { ip: "198.51.100.9" });
    const n = await prisma.notification.findFirst({ where: { userId: admin.id, entityId: user.id, title: { contains: "قفل مؤقت" } } });
    expect(n).not.toBeNull();
    expect(n?.body).toContain("198.51.100.9");
    expect(await prisma.auditLog.count({ where: { action: "auth.account_locked", entityId: user.id } })).toBe(1);
  });
});

describe("حقن SQL", () => {
  it("مدخلات خبيثة في البريد لا تكسر الاستعلامات", async () => {
    const r = await login(prisma, { email: "a'@x.sa' OR '1'='1", password: "x" });
    expect(r.ok).toBe(false);
    const r2 = await login(prisma, { email: "admin@x.sa'; DROP TABLE users; --", password: "x" });
    expect(r2.ok).toBe(false);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });
});
