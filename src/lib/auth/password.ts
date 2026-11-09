import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id وفق توصيات OWASP (m=19MiB, t=2, p=1).
 * algorithm: 2 = Argon2id في @node-rs/argon2.
 */
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

// تجزئة ثابتة تستخدم عند عدم وجود المستخدم لتوحيد زمن الاستجابة (منع تعداد الحسابات)
let dummyHash: Promise<string> | null = null;
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword("zaki-timing-equalizer-not-a-real-password");
  await verifyPassword(await dummyHash, plain);
}

/** سياسة كلمة المرور: 10 أحرف على الأقل، تحتوي حرفًا ورقمًا، وليست شائعة. */
export function validatePasswordPolicy(pw: string, context: { email?: string; name?: string } = {}): string | null {
  if (pw.length < 10) return "كلمة المرور يجب ألا تقل عن 10 أحرف";
  if (pw.length > 128) return "كلمة المرور طويلة جدًا";
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return "كلمة المرور يجب أن تحتوي على أحرف وأرقام";
  const lower = pw.toLowerCase();
  const banned = ["password", "12345678", "qwerty", "zaki", "admin", "123456789"];
  if (banned.some((b) => lower.includes(b))) return "كلمة المرور سهلة التخمين";
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return "كلمة المرور يجب ألا تحتوي على البريد الإلكتروني";
  return null;
}
