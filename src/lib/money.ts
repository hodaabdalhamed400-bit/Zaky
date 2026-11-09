import { Prisma } from "@prisma/client";

/**
 * التعامل مع الأموال عبر Prisma.Decimal فقط — لا floating-point.
 * التقريب إلى هللتين (منزلتين) بطريقة ROUND_HALF_UP.
 */
export const Decimal = Prisma.Decimal;
export type Money = Prisma.Decimal;

export function money(v: Prisma.Decimal.Value): Money {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function sum(values: Prisma.Decimal.Value[]): Money {
  return values.reduce<Money>((acc, v) => acc.plus(v), new Prisma.Decimal(0)).toDecimalPlaces(2);
}

const sarFmt = new Intl.NumberFormat("ar-SA-u-nu-latn", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** عرض المبلغ: 12,345.50 ر.س — التنسيق من Decimal كنص لتجنب أخطاء الفاصلة العائمة في العرض. */
export function formatSAR(v: Prisma.Decimal.Value | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const d = money(v);
  // Intl يقبل النص الرقمي بدقة كاملة في Node 20+
  return `${sarFmt.format(d.toFixed(2) as unknown as number)} ر.س`;
}
