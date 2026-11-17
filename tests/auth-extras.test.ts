import { describe, expect, it } from "vitest";
import { prisma, makeUser, makeActor, STRONG, uniqueEmail } from "./helpers";
import { login } from "@/services/auth.service";
import { validateSession } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { buildMime } from "@/lib/mail";
import { RESET_LIMITS, RESET_REQUESTED_MESSAGE, checkResetToken, requestPasswordReset, resetPasswordWithToken } from "@/services/password-reset.service";
import { describeDevice, isNewDevice } from "@/services/login-alerts.service";
import { createShareLink, getSharedTenantView, revokeShareLinks } from "@/services/tenant-share.service";

const NEW_PW = "N3w-Secure-Pass-77";

/** يستخرج الرمز من رابط مثل .../login/reset?token=XYZ أو .../t/XYZ */
const tokenFrom = (url: string) => decodeURIComponent(url.split(/token=|\/t\//)[1]!);

describe("نسيت كلمة المرور", () => {
  it("نفس الرد لبريد موجود وغير موجود (منع تعداد الحسابات)", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const a = await requestPasswordReset(prisma, user.email, {}, async () => true);
    const b = await requestPasswordReset(prisma, uniqueEmail("ghost"), {}, async () => true);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.message).toBe(b.message);
    expect(a.ok && a.message).toBe(RESET_REQUESTED_MESSAGE);
  });

  it("بدون إيميل مُعدّ: يصل تنبيه داخلي لمسؤولي المستخدمين", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const r = await requestPasswordReset(prisma, user.email, {});
    expect(r.ok && r.delivery).toBe("admin");
    const n = await prisma.notification.findFirst({ where: { userId: admin.id, entityId: user.id } });
    expect(n?.link).toBe(`/users/${user.id}`);
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
  });

  it("الرابط يغيّر كلمة المرور مرة وحدة، ويلغي الجلسات، ويُخزَّن كـ hash فقط", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const before = await login(prisma, { email: user.email, password: STRONG });
    expect(before.ok).toBe(true);

    // نصدر رمزًا مباشرة بنفس طريقة الخدمة (الإيميل نفسه مغطى باختبار MIME)
    const { generateSessionToken } = await import("@/lib/auth/tokens");
    const token = generateSessionToken();
    await prisma.passwordResetToken.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } });
    expect(await prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    expect((await checkResetToken(prisma, token)).valid).toBe(true);
    const weak = await resetPasswordWithToken(prisma, { token, newPassword: "short", confirmPassword: "short" });
    expect(weak.ok).toBe(false);
    const ok = await resetPasswordWithToken(prisma, { token, newPassword: NEW_PW, confirmPassword: NEW_PW });
    expect(ok.ok).toBe(true);

    const again = await resetPasswordWithToken(prisma, { token, newPassword: NEW_PW + "x", confirmPassword: NEW_PW + "x" });
    expect(again.ok).toBe(false);
    if (before.ok === true) expect(await validateSession(prisma, before.token)).toBeNull();
    expect((await login(prisma, { email: user.email, password: STRONG })).ok).toBe(false);
    expect((await login(prisma, { email: user.email, password: NEW_PW })).ok).toBe(true);
  });

  it("الرابط المنتهي مرفوض", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const { generateSessionToken } = await import("@/lib/auth/tokens");
    const token = generateSessionToken();
    await prisma.passwordResetToken.create({ data: { tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() - 1000) } });
    expect((await checkResetToken(prisma, token)).valid).toBe(false);
    const r = await resetPasswordWithToken(prisma, { token, newPassword: NEW_PW, confirmPassword: NEW_PW });
    expect(r.ok).toBe(false);
  });

  it("حد الطلبات لكل حساب في الساعة", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    for (let i = 0; i < RESET_LIMITS.perEmailPerHour + 2; i++) await requestPasswordReset(prisma, user.email, {});
    expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(RESET_LIMITS.perEmailPerHour);
  });

  it("رسالة الإيميل مُرمّزة ولا تسمح بحقن ترويسات", () => {
    const mime = buildMime("erp@x.sa", { to: "a@b.sa", subject: "سطر\r\nBcc: evil@x.sa", html: "<p>هلا</p>", text: "هلا" });
    expect(mime).not.toMatch(/^Bcc:/m);
    expect(mime).toMatch(/^Subject: =\?UTF-8\?B\?/m);
  });
});

describe("تذكّرني والأجهزة الجديدة", () => {
  it("«تذكّرني» تنشئ جلسة أطول وتتحمل خمول أطول", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const r = await login(prisma, { email: user.email, password: STRONG, remember: "1" });
    expect(r.ok).toBe(true);
    if (r.ok !== true) return;
    const s = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(r.token) } });
    expect(s.persistent).toBe(true);
    expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBe(168 * 3600_000);
    // بعد 5 ساعات خمول: الجلسة العادية تنتهي (120 دقيقة) لكن «تذكّرني» تبقى
    const later = new Date(s.lastSeenAt.getTime() + 5 * 3600_000);
    expect(await validateSession(prisma, r.token, later)).not.toBeNull();
    const normal = await login(prisma, { email: user.email, password: STRONG });
    if (normal.ok === true) expect(await validateSession(prisma, normal.token, later)).toBeNull();
  });

  it("يكتشف الجهاز الجديد ولا يعتبر أول دخول جهازًا جديدًا", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
    const win = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
    const first = await login(prisma, { email: user.email, password: STRONG }, { userAgent: mac });
    if (first.ok !== true) throw new Error("login failed");
    const s1 = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(first.token) } });
    expect(await isNewDevice(prisma, user.id, s1.id, mac)).toBe(false);
    const second = await login(prisma, { email: user.email, password: STRONG }, { userAgent: win });
    if (second.ok !== true) throw new Error("login failed");
    const s2 = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(second.token) } });
    expect(await isNewDevice(prisma, user.id, s2.id, win)).toBe(true);
    expect(describeDevice(win)).toBe("Chrome على Windows");
  });
});

describe("صفحة المستأجر برابط", () => {
  it("تعرض بيانات المستأجر فقط، وتتوقف عند الإلغاء", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const tenant = await prisma.tenant.create({ data: { type: "COMPANY", name: "شركة اختبار الرابط", nationalId: "1234567890", status: "ACTIVE" } });
    const { url } = await createShareLink(prisma, actor, tenant.id, { days: 30 });
    const token = tokenFrom(url);
    expect(await prisma.tenantShareLink.count({ where: { tokenHash: token } })).toBe(0);

    const v = await getSharedTenantView(prisma, token);
    expect(v?.tenant.name).toBe("شركة اختبار الرابط");
    expect(JSON.stringify(v)).not.toContain("1234567890");
    const link = await prisma.tenantShareLink.findFirstOrThrow({ where: { tenantId: tenant.id } });
    expect(link.viewCount).toBe(1);

    await revokeShareLinks(prisma, actor, tenant.id);
    expect(await getSharedTenantView(prisma, token)).toBeNull();
    expect(await getSharedTenantView(prisma, "not-a-real-token-xxxxxxxxxxxx")).toBeNull();
  });

  it("يرفض من لا يملك صلاحية إدارة المستأجرين", async () => {
    const { actor } = await makeActor("READ_ONLY", { branchCodes: ["GRN"] });
    const tenant = await prisma.tenant.create({ data: { type: "INDIVIDUAL", name: "فرد", status: "ACTIVE" } });
    await expect(createShareLink(prisma, actor, tenant.id, { days: 30 })).rejects.toThrow();
  });
});
