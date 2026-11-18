import { afterEach, describe, expect, it, vi } from "vitest";

/** إعدادات البريد الخاطئة أو الفارغة يجب ألا توقف النظام كله (تتجاهل بهدوء). */
describe("متغيرات البيئة الاختيارية", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("الخانات الفارغة والقيم غير الصالحة لإعدادات البريد لا توقف التشغيل", async () => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_USER", "");
    vi.stubEnv("SMTP_PASS", "");
    vi.stubEnv("SMTP_PORT", "");
    vi.stubEnv("APP_URL", "ليس-رابطًا");
    vi.stubEnv("MAIL_FROM", "Zaki <noreply@example.sa>");
    const { env } = await import("@/lib/env");
    const e = env();
    expect(e.SMTP_HOST).toBeUndefined();
    expect(e.SMTP_USER).toBeUndefined();
    expect(e.SMTP_PORT).toBe(465);
    expect(e.APP_URL).toBeUndefined();
    expect(e.MAIL_FROM).toBe("Zaki <noreply@example.sa>");
  });

  it("القيم الصحيحة تُقرأ كما هي", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.sa");
    vi.stubEnv("SMTP_PORT", "587");
    vi.stubEnv("APP_URL", "https://erp.smartcompany.sa");
    const { env } = await import("@/lib/env");
    const e = env();
    expect(e.SMTP_HOST).toBe("smtp.example.sa");
    expect(e.SMTP_PORT).toBe(587);
    expect(e.APP_URL).toBe("https://erp.smartcompany.sa");
  });
});
