import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** TOTP وفق RFC 6238 (HMAC-SHA1، 30 ثانية، 6 أرقام) — متوافق مع Google/Microsoft Authenticator. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;

/** يحول الأرقام العربية (٠-٩) والفارسية (۰-۹) إلى إنجليزية — لوحة المفاتيح العربية تكتبها هكذا. */
export function normalizeDigits(s: string) {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20)); // 160 بت
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

export function totpAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

/**
 * يتحقق من الرمز ضمن نافذة ±1 خطوة (لفروق الساعة)، ويرفض أي خطوة سبق استخدامها
 * (lastStep) — فلا يمكن إعادة استخدام رمز التُقط.
 * يُرجع الخطوة المطابقة أو null.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  const c = normalizeDigits(code).replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const cur = currentStep(now);
  for (const step of [cur - 1, cur, cur + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    if (timingSafeEqual(expected, Buffer.from(c))) return step;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "ZAKI Smart ERP") {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
