import { z } from "zod";
import { AppError } from "@/lib/errors";

/** نص اختياري: الفراغ يصبح null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max, `النص أطول من ${max} حرف`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+\d\s-]*$/, "رقم الجوال غير صحيح")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** رابط https فقط (يمنع javascript: وما شابه). */
export const httpsUrl = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => {
    if (!v) return true;
    try {
      return new URL(v).protocol === "https:";
    } catch {
      return false;
    }
  }, "الرابط يجب أن يبدأ بـ https://");

/** مبلغ أو رقم عشري بمنزلتين كحد أقصى، يُعاد كنص (يُمرَّر لـ Prisma Decimal بلا floating-point). */
export const decimalString = (label: string, opts: { min?: number; allowZero?: boolean } = {}) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[,،\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))))
    .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), `${label}: أدخل رقمًا صحيحًا بمنزلتين عشريتين كحد أقصى`)
    .refine((v) => (opts.allowZero ? Number(v) >= 0 : Number(v) > 0), `${label} يجب أن يكون أكبر من صفر`);

export const optionalDecimalString = (label: string) =>
  z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))
    .pipe(z.union([z.null(), decimalString(label)]));

/** يحلل المدخلات ويرمي خطأ عربيًا واضحًا بأول مشكلة. */
export function parseInput<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError("VALIDATION", r.error.issues[0]?.message ?? "بيانات غير صحيحة");
  return r.data;
}
