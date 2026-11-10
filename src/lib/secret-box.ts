import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * تشفير الأسرار المخزنة (سر التحقق الثنائي) بـ AES-256-GCM.
 * المفتاح من MFA_ENCRYPTION_KEY (إلزامي في الإنتاج). في التطوير/الاختبار فقط يُستخدم مفتاح تطوير ثابت.
 */
function key(): Buffer {
  const e = env();
  const raw = e.MFA_ENCRYPTION_KEY;
  if (!raw) {
    if (e.NODE_ENV === "production" && process.env.ZAKI_ALLOW_DEV_MFA_KEY !== "1")
      throw new Error("MFA_ENCRYPTION_KEY غير مضبوط — مطلوب في الإنتاج لتفعيل التحقق الثنائي");
    return createHash("sha256").update("zaki-dev-only-mfa-key-do-not-use-in-production").digest();
  }
  return createHash("sha256").update(raw).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("صيغة سر غير صالحة");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}
