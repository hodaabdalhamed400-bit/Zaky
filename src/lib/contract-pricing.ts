import { Prisma, type BillingCycle } from "@prisma/client";
import { addDays, addMonthsKeepDay, installmentPeriods } from "./dates";
import { money, splitVatInclusive } from "./money";

/**
 * حسابات العقد — دوال نقية مختبرة، تطبّق القرارات المعتمدة:
 * - الأسعار شاملة ضريبة القيمة المضافة 15%.
 * - القسط يستحق في نفس يوم بداية العقد من كل دورة.
 * - مدة العقد بالأشهر الكاملة: النهاية = البداية + N شهر − يوم.
 * - الخصم مبلغ على إجمالي العقد، يُوزَّع على الأقساط بنسبة قيمتها (والفرق في التقريب على القسط الأخير).
 */
export const CYCLE_MONTHS: Record<Exclude<BillingCycle, "CUSTOM">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMI_ANNUAL: 6,
  ANNUAL: 12,
};

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  SEMI_ANNUAL: "نصف سنوي",
  ANNUAL: "سنوي",
  CUSTOM: "مخصص",
};

export function contractEndDate(startYmd: string, months: number): string {
  return addDays(addMonthsKeepDay(startYmd, months), -1);
}

export type PricingInput = {
  startDate: string;
  durationMonths: number;
  billingCycle: Exclude<BillingCycle, "CUSTOM">;
  monthlyPrices: Prisma.Decimal.Value[]; // سعر شهري لكل وحدة (شامل الضريبة)
  discount: Prisma.Decimal.Value; // مبلغ خصم على إجمالي العقد (شامل الضريبة)
  vatRate: Prisma.Decimal.Value;
};

export type Installment = {
  seqNo: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  months: number;
  gross: Prisma.Decimal;
  discount: Prisma.Decimal;
  amountDue: Prisma.Decimal;
  net: Prisma.Decimal;
  vat: Prisma.Decimal;
};

export function computeContract(input: PricingInput) {
  const { startDate, durationMonths, billingCycle } = input;
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120) throw new Error("مدة العقد غير صحيحة");
  if (input.monthlyPrices.length === 0) throw new Error("يجب اختيار وحدة واحدة على الأقل");
  const monthly = money(input.monthlyPrices.reduce<Prisma.Decimal>((a, p) => a.plus(money(p)), new Prisma.Decimal(0)));
  if (monthly.lte(0)) throw new Error("الإيجار الشهري يجب أن يكون أكبر من صفر");
  const endDate = contractEndDate(startDate, durationMonths);
  const rent = monthly.times(durationMonths);
  const discount = money(input.discount);
  if (discount.isNegative()) throw new Error("الخصم لا يمكن أن يكون سالبًا");
  if (discount.gt(rent)) throw new Error("الخصم أكبر من قيمة العقد");
  const total = rent.minus(discount);

  const cycle = CYCLE_MONTHS[billingCycle];
  const periods = installmentPeriods(startDate, endDate, cycle);
  let discountLeft = discount;
  const installments: Installment[] = periods.map((p, i) => {
    const consumed = i * cycle;
    const months = Math.min(cycle, durationMonths - consumed);
    const gross = monthly.times(months);
    const isLast = i === periods.length - 1;
    const d = isLast ? discountLeft : discount.times(gross).div(rent).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    discountLeft = discountLeft.minus(d);
    const amountDue = gross.minus(d);
    const { net, vat } = splitVatInclusive(amountDue, input.vatRate);
    return { ...p, months, gross, discount: d, amountDue, net, vat };
  });
  // ضريبة العقد = مجموع ضريبة الأقساط، حتى تتطابق التقارير هللةً بهللة
  const vat = installments.reduce((a, x) => a.plus(x.vat), new Prisma.Decimal(0));
  return { endDate, monthly, rent, discount, total, vat, net: total.minus(vat), installments };
}

/** السعر الشهري الافتراضي لوحدة من سعرها الأساسي (للاقتراح فقط؛ يمكن تعديله في العقد). */
export function defaultMonthlyPrice(basePrice: Prisma.Decimal.Value, cycle: "HOUR" | "DAY" | "MONTH" | "YEAR", seats = 1): Prisma.Decimal | null {
  const b = money(basePrice);
  if (cycle === "MONTH") return money(b.times(seats));
  if (cycle === "YEAR") return money(b.div(12).times(seats));
  return null; // الساعة/اليوم ليست أساسًا لعقد شهري
}
