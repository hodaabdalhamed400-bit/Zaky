/**
 * محدِّد معدل بسيط في الذاكرة (نافذة منزلقة) — للطلبات العامة التي لا تكتب في قاعدة البيانات
 * (مثل «نسيت كلمة المرور» لبريد غير موجود، وصفحة المستأجر). النظام يعمل على نسخة واحدة في Render،
 * فالذاكرة كافية؛ حدود الدخول الأساسية مخزنة في قاعدة البيانات (login_attempts).
 */
const buckets = new Map<string, number[]>();
let lastSweep = 0;

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  if (now - lastSweep > 60_000) {
    lastSweep = now;
    for (const [k, v] of buckets) if (!v.length || now - v[v.length - 1]! > windowMs) buckets.delete(k);
  }
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

export function resetRateLimits() {
  buckets.clear();
}
