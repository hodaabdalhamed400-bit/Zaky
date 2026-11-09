export const TIMEZONE = "Asia/Riyadh";

const dateFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const dateTimeFmt = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(d: Date | null | undefined): string {
  return d ? dateFmt.format(d) : "—";
}
export function formatDateTime(d: Date | null | undefined): string {
  return d ? dateTimeFmt.format(d) : "—";
}

/** تاريخ اليوم بتوقيت الرياض بصيغة YYYY-MM-DD (لأعمدة DATE). */
export function todayInRiyadh(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
}

/** يحول YYYY-MM-DD إلى Date بمنتصف ليل UTC، وهو ما يتوقعه Prisma لأعمدة @db.Date. */
export function dateOnly(ymd: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new Error(`Invalid date: ${ymd}`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function addDays(ymd: string, days: number): string {
  const d = dateOnly(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * يضيف أشهرًا مع الحفاظ على يوم البداية، وإن لم يوجد في الشهر الهدف يُستخدم آخر يوم فيه
 * (مثال: 31 يناير + شهر = 28/29 فبراير، ثم 31 مارس).
 */
export function addMonthsKeepDay(startYmd: string, months: number): string {
  const [y, m, d] = startYmd.split("-").map(Number) as [number, number, number];
  dateOnly(startYmd);
  const total = m - 1 + months;
  const year = y + Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(year, month0));
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * تواريخ استحقاق الأقساط — قرار معتمد: القسط يستحق في نفس يوم بداية العقد
 * (عقد يبدأ يوم 12 ⇐ الاستحقاق يوم 12 من كل دورة). الفترة الأولى تبدأ يوم بداية العقد.
 * @param cycleMonths 1 شهري، 3 ربع سنوي، 6 نصف سنوي، 12 سنوي
 */
export function installmentPeriods(startYmd: string, endYmd: string, cycleMonths: number) {
  if (!Number.isInteger(cycleMonths) || cycleMonths < 1) throw new Error("دورة الدفع غير صحيحة");
  if (endYmd < startYmd) throw new Error("تاريخ النهاية قبل البداية");
  const periods: { seqNo: number; periodStart: string; periodEnd: string; dueDate: string }[] = [];
  for (let i = 0; ; i++) {
    const periodStart = addMonthsKeepDay(startYmd, i * cycleMonths);
    if (periodStart > endYmd) break;
    const nextStart = addMonthsKeepDay(startYmd, (i + 1) * cycleMonths);
    const periodEnd = addDays(nextStart, -1) < endYmd ? addDays(nextStart, -1) : endYmd;
    periods.push({ seqNo: i + 1, periodStart, periodEnd, dueDate: periodStart });
  }
  return periods;
}

/**
 * قرار معتمد: لا توجد مهلة سماح. القسط غير المسدد بالكامل يصبح متأخرًا
 * بمجرد انتهاء يوم استحقاقه (بتوقيت الرياض)، أي من اليوم التالي.
 */
export function isOverdue(dueYmd: string, todayYmd = todayInRiyadh()): boolean {
  return todayYmd > dueYmd;
}
