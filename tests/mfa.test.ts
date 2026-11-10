import { describe, expect, it } from "vitest";
process.env.MFA_ENFORCE = "true"; // قبل أول قراءة لمتغيرات البيئة في هذا الملف
import { prisma, makeActor, makeUser, STRONG } from "./helpers";
import { base32Encode, currentStep, totpAt, verifyTotp } from "@/lib/totp";
import { open, seal } from "@/lib/secret-box";
import { login } from "@/services/auth.service";
import { beginEnrollment, confirmEnrollment, mustEnrollMfa, resetUserMfa, verifyChallenge } from "@/services/mfa.service";
import { validateSession } from "@/lib/auth/session";

describe("TOTP", () => {
  it("يطابق متجه الاختبار الرسمي RFC 6238 (SHA1)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(secret, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpAt(secret, Math.floor(2000000000 / 30))).toBe("279037");
  });
  it("نافذة ±30 ثانية، ورفض الرمز المستخدم سابقًا", () => {
    const secret = base32Encode(Buffer.from("abcdefghijabcdefghij"));
    const now = Date.now();
    const step = currentStep(now);
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull();
    expect(verifyTotp(secret, "12345", null, now)).toBeNull();
    // أرقام لوحة المفاتيح العربية
    const ar = totpAt(secret, step).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]!);
    expect(verifyTotp(secret, ar, null, now)).toBe(step);
  });
  it("تشفير الأسرار المخزنة (AES-256-GCM) ورفض أي عبث", () => {
    const s = seal("JBSWY3DPEHPK3PXP");
    expect(s).not.toContain("JBSWY3DPEHPK3PXP");
    expect(open(s)).toBe("JBSWY3DPEHPK3PXP");
    const parts = s.split(".");
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith("A") ? "BB" : "AA");
    expect(() => open(parts.join("."))).toThrow();
  });
});

async function enrolled(role: "SUPER_ADMIN" | "ACCOUNTANT" = "ACCOUNTANT") {
  const { actor, user } = await makeActor(role, { branchCodes: role === "ACCOUNTANT" ? ["IZD"] : [] });
  const { secret } = await beginEnrollment(prisma, actor);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(stored.mfaSecretEnc).not.toContain(secret);
  await expect(confirmEnrollment(prisma, actor, "000000")).rejects.toThrow(/غير صحيح/);
  // نستخدم خطوة سابقة للتأكيد حتى يبقى رمز الخطوة الحالية صالحًا لاختبار الدخول
  const { recoveryCodes } = await confirmEnrollment(prisma, actor, totpAt(secret, currentStep() - 1));
  return { actor, user, secret, recoveryCodes };
}

describe("تفعيل التحقق الثنائي", () => {
  it("التأكيد يستخدم المفتاح المعروض حتى لو بُدئ التفعيل مرة أخرى في تبويب آخر", async () => {
    const { actor } = await makeActor("ACCOUNTANT", { branchCodes: ["IZD"] });
    const first = await beginEnrollment(prisma, actor);
    await beginEnrollment(prisma, actor); // تبويب آخر غيّر المفتاح المحفوظ
    await expect(confirmEnrollment(prisma, actor, totpAt(first.secret, currentStep()))).rejects.toThrow(/غير صحيح/);
    const r = await confirmEnrollment(prisma, actor, totpAt(first.secret, currentStep()), {}, first.ticket);
    expect(r.recoveryCodes).toHaveLength(8);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    expect(open(u.mfaSecretEnc!)).toBe(first.secret);
  });

  it("تذكرة مستخدم آخر لا تُقبل، ويُشخَّص فرق وقت الجوال", async () => {
    const { actor: a } = await makeActor("ACCOUNTANT", { branchCodes: ["IZD"] });
    const { actor: b } = await makeActor("ACCOUNTANT", { branchCodes: ["IZD"] });
    const ta = await beginEnrollment(prisma, a);
    await beginEnrollment(prisma, b);
    await expect(confirmEnrollment(prisma, b, totpAt(ta.secret, currentStep()), {}, ta.ticket)).rejects.toThrow(/غير صحيح/);
    await expect(confirmEnrollment(prisma, a, totpAt(ta.secret, currentStep() - 4), {}, ta.ticket)).rejects.toThrow(/متأخر بنحو 120 ثانية/);
  });
});

describe("الدخول بالتحقق الثنائي", () => {
  it("كلمة المرور وحدها لا تنشئ جلسة؛ الرمز الصحيح يكمل الدخول ولا يُعاد استخدامه", async () => {
    const { user, secret } = await enrolled();
    const before = await prisma.session.count({ where: { userId: user.id } });
    const r1 = await login(prisma, { email: user.email, password: STRONG });
    expect(r1.ok).toBe("mfa");
    if (r1.ok !== "mfa") return;
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(before);
    const code = totpAt(secret, currentStep());
    const ok = await verifyChallenge(prisma, r1.challengeToken, code);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(await validateSession(prisma, ok.token)).not.toBeNull();
    // نفس التحدي مرة أخرى
    expect((await verifyChallenge(prisma, r1.challengeToken, code)).ok).toBe(false);
    // نفس الرمز في تحدٍ جديد (إعادة استخدام)
    const r2 = await login(prisma, { email: user.email, password: STRONG });
    if (r2.ok !== "mfa") throw new Error("expected mfa");
    expect((await verifyChallenge(prisma, r2.challengeToken, code)).ok).toBe(false);
  });

  it("خمس محاولات خاطئة تُبطل التحدي وتُسجَّل", async () => {
    const { user } = await enrolled();
    const r = await login(prisma, { email: user.email, password: STRONG });
    if (r.ok !== "mfa") throw new Error("expected mfa");
    let last;
    for (let i = 0; i < 5; i++) last = await verifyChallenge(prisma, r.challengeToken, "111111");
    expect(last).toMatchObject({ ok: false, restart: true });
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: "auth.mfa_failed" } })).toBe(5);
    await expect(Promise.resolve(verifyChallenge(prisma, "x".repeat(43), "111111"))).resolves.toMatchObject({ ok: false, restart: true });
  });

  it("رمز الاسترداد يعمل مرة واحدة فقط", async () => {
    const { user, recoveryCodes } = await enrolled();
    expect(recoveryCodes).toHaveLength(8);
    const r = await login(prisma, { email: user.email, password: STRONG });
    if (r.ok !== "mfa") throw new Error("expected mfa");
    const ok = await verifyChallenge(prisma, r.challengeToken, recoveryCodes[0]!.toLowerCase());
    expect(ok).toMatchObject({ ok: true, usedRecovery: true, remainingRecovery: 7 });
    const r2 = await login(prisma, { email: user.email, password: STRONG });
    if (r2.ok !== "mfa") throw new Error("expected mfa");
    expect((await verifyChallenge(prisma, r2.challengeToken, recoveryCodes[0]!)).ok).toBe(false);
  });

  it("الفرض على الإدارة، وإعادة التعيين من مسؤول آخر تنهي الجلسات", async () => {
    const { actor: gm } = await makeActor("GENERAL_MANAGER");
    expect(await mustEnrollMfa(prisma, gm)).toBe(true);
    const { actor: acc } = await makeActor("ACCOUNTANT", { branchCodes: ["IZD"] });
    expect(await mustEnrollMfa(prisma, acc)).toBe(false);
    const { actor: sa, user } = await enrolled("SUPER_ADMIN");
    expect(await mustEnrollMfa(prisma, sa)).toBe(false);
    await expect(resetUserMfa(prisma, sa, user.id)).rejects.toThrow(/بنفسك/);
    await expect(resetUserMfa(prisma, gm, user.id)).rejects.toThrow(/مسؤول النظام/);
    const other = await makeUser("SUPER_ADMIN");
    const { actor: sa2 } = await makeActor("SUPER_ADMIN");
    void other;
    await resetUserMfa(prisma, sa2, user.id);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(u).toMatchObject({ mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryHashes: [] });
    expect(await validateSession(prisma, sa.sessionId ? (await prisma.session.findUniqueOrThrow({ where: { id: sa.sessionId } })).tokenHash : "")).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
  });
});
