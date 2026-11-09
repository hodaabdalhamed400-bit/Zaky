import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // مدة الجلسة القصوى بالساعات، ومهلة الخمول بالدقائق
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  // يتطلب HTTPS للكوكي (يجب أن يكون true في الإنتاج)
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // عدد الوكلاء العكسيين الموثوقين لقراءة X-Forwarded-For (Render = 1)
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(
        "متغيرات البيئة غير صحيحة: " +
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    }
    cached = parsed.data;
  }
  return cached;
}

export function cookieSecure(): boolean {
  const e = env();
  return e.COOKIE_SECURE ?? e.NODE_ENV === "production";
}
