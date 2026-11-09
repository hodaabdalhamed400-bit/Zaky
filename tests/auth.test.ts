import { describe, expect, it } from "vitest";
import { prisma, makeUser, STRONG, uniqueEmail, makeActor } from "./helpers";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/lib/auth/password";
import { createSession, validateSession } from "@/lib/auth/session";
import { changeOwnPassword, login, logout, LOGIN_LIMITS } from "@/services/auth.service";
import { hashToken } from "@/lib/auth/tokens";

describe("كلمات المرور", () => {
  it("تُشفَّر بـ Argon2id ولا تُخزَّن كنص", async () => {
    const h = await hashPassword(STRONG);
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).not.toContain(STRONG);
    expect(await verifyPassword(h, STRONG)).toBe(true);
    expect(await verifyPassword(h, STRONG + "x")).toBe(false);
    expect(await verifyPassword("not-a-hash", STRONG)).toBe(false);
  });

  it("سياسة كلمة المرور ترفض الضعيفة", () => {
    expect(validatePasswordPolicy("short1")).toMatch(/10/);
    expect(validatePasswordPolicy("onlyletterslong")).toMatch(/أرقام/);
    expect(validatePasswordPolicy("Password12345")).toMatch(/سهلة/);
    expect(validatePasswordPolicy("ahmedsalem99x", { email: "ahmedsalem@x.sa" })).toMatch(/البريد/);
    expect(validatePasswordPolicy(STRONG)).toBeNull();
  });
});

describe("تسجيل الدخول", () => {
  it("ينجح ببيانات صحيحة وينشئ جلسة مخزنة كـ hash فقط", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const res = await login(prisma, { email: user.email.toUpperCase(), password: STRONG }, { ip: "10.0.0.1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = await prisma.session.findUnique({ where: { tokenHash: hashToken(res.token) } });
    expect(s?.userId).toBe(user.id);
    expect(await prisma.session.count({ where: { tokenHash: res.token } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({ where: { action: "auth.login", entityId: user.id } });
    expect(audit).not.toBeNull();
  });

  it("رسالة خطأ موحدة لكلمة مرور خاطئة أو بريد غير موجود (منع تعداد الحسابات)", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const a = await login(prisma, { email: user.email, password: "Wrong-pass-123" });
    const b = await login(prisma, { email: uniqueEmail("ghost"), password: "Wrong-pass-123" });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) expect(a.error).toBe(b.error);
  });

  it("يقفل الدخول مؤقتًا بعد تجاوز حد المحاولات حتى بكلمة المرور الصحيحة", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    for (let i = 0; i < LOGIN_LIMITS.maxFailuresPerEmail; i++) {
      const r = await login(prisma, { email: user.email, password: "Wrong-pass-123" }, { ip: "10.9.9.9" });
      expect(r.ok).toBe(false);
    }
    const r = await login(prisma, { email: user.email, password: STRONG }, { ip: "10.9.9.10" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/محاولات كثيرة/);
  });

  it("يرفض الحساب المعطل", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"], isActive: false });
    const r = await login(prisma, { email: user.email, password: STRONG });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/معطل/);
  });

  it("يرفض المدخلات غير الصالحة دون أخطاء خادم", async () => {
    const r = await login(prisma, { email: "not-an-email", password: "" });
    expect(r.ok).toBe(false);
  });
});

describe("الجلسات", () => {
  it("تنتهي بعد مهلة الخمول", async () => {
    const user = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const { token } = await createSession(prisma, user.id);
    expect(await validateSession(prisma, token)).not.toBeNull();
    const future = new Date(Date.now() + 3 * 3600_000);
    expect(await validateSession(prisma, token, future)).toBeNull();
    // وتبقى ملغاة بعد ذلك
    expect(await validateSession(prisma, token)).toBeNull();
  });

  it("رمز عشوائي أو فارغ لا يعطي جلسة", async () => {
    expect(await validateSession(prisma, "")).toBeNull();
    expect(await validateSession(prisma, "x".repeat(43))).toBeNull();
  });

  it("تسجيل الخروج يلغي الجلسة", async () => {
    const { actor, token } = await makeActor("READ_ONLY", { branchCodes: ["GRN"] });
    await logout(prisma, actor);
    expect(await validateSession(prisma, token)).toBeNull();
  });

  it("تغيير كلمة المرور يُبطل جميع الجلسات القديمة ويصدر جلسة جديدة", async () => {
    const { actor, token, user } = await makeActor("READ_ONLY", { branchCodes: ["GRN"] });
    const other = await createSession(prisma, user.id);
    const newPw = "N3w-Secure-Pass-77";
    await expect(
      changeOwnPassword(prisma, actor, { currentPassword: "wrong", newPassword: newPw, confirmPassword: newPw }),
    ).rejects.toThrow(/الحالية/);
    const res = await changeOwnPassword(prisma, actor, { currentPassword: STRONG, newPassword: newPw, confirmPassword: newPw });
    expect(await validateSession(prisma, token)).toBeNull();
    expect(await validateSession(prisma, other.token)).toBeNull();
    expect(await validateSession(prisma, res.token)).not.toBeNull();
    // انحدار: الجلسة الجديدة ليست أقدم من تغيير كلمة المرور (كانت تسبب خروجًا فوريًا)
    const fresh = await prisma.session.findUniqueOrThrow({ where: { tokenHash: hashToken(res.token) } });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(fresh.createdAt.getTime()).toBeGreaterThanOrEqual(u.passwordChangedAt.getTime());
    const r = await login(prisma, { email: user.email, password: newPw });
    expect(r.ok).toBe(true);
  });
});
