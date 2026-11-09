import { describe, expect, it } from "vitest";
import { computeContract, contractEndDate, defaultMonthlyPrice } from "@/lib/contract-pricing";

const base = { startDate: "2026-01-12", vatRate: "0.15", discount: "0" } as const;

describe("حسابات العقد", () => {
  it("عقد سنوي شهري: 12 قسطًا يوم 12، الإجمالي والضريبة صحيحة", () => {
    const c = computeContract({ ...base, durationMonths: 12, billingCycle: "MONTHLY", monthlyPrices: ["1150"] });
    expect(c.endDate).toBe("2027-01-11");
    expect(c.total.toFixed(2)).toBe("13800.00");
    expect(c.installments).toHaveLength(12);
    expect(c.installments.every((i) => i.dueDate.endsWith("-12"))).toBe(true);
    expect(c.installments[0]!.vat.toFixed(2)).toBe("150.00");
    expect(c.vat.toFixed(2)).toBe("1800.00");
    expect(c.net.toFixed(2)).toBe("12000.00");
  });

  it("أكثر من وحدة في عقد واحد ودورة ربع سنوية", () => {
    const c = computeContract({ ...base, durationMonths: 12, billingCycle: "QUARTERLY", monthlyPrices: ["2000", "1500.50"] });
    expect(c.monthly.toFixed(2)).toBe("3500.50");
    expect(c.installments.map((i) => i.amountDue.toFixed(2))).toEqual(Array(4).fill("10501.50"));
    expect(c.installments.map((i) => i.dueDate)).toEqual(["2026-01-12", "2026-04-12", "2026-07-12", "2026-10-12"]);
  });

  it("مدة لا تقبل القسمة على الدورة: القسط الأخير بعدد الأشهر المتبقية", () => {
    const c = computeContract({ ...base, durationMonths: 10, billingCycle: "QUARTERLY", monthlyPrices: ["1000"] });
    expect(c.installments.map((i) => i.months)).toEqual([3, 3, 3, 1]);
    expect(c.installments.at(-1)!.amountDue.toFixed(2)).toBe("1000.00");
    expect(c.installments.at(-1)!.periodEnd).toBe(c.endDate);
  });

  it("الخصم يُوزَّع على الأقساط ومجموعها يطابق الإجمالي تمامًا", () => {
    const c = computeContract({ ...base, durationMonths: 12, billingCycle: "MONTHLY", monthlyPrices: ["1000"], discount: "1000" });
    expect(c.total.toFixed(2)).toBe("11000.00");
    const sum = c.installments.reduce((a, i) => a + Math.round(Number(i.amountDue) * 100), 0);
    expect(sum).toBe(1100000);
    const vatSum = c.installments.reduce((a, i) => a.plus(i.vat), c.installments[0]!.vat.minus(c.installments[0]!.vat));
    expect(vatSum.toFixed(2)).toBe(c.vat.toFixed(2));
    for (const i of c.installments) expect(i.net.plus(i.vat).toFixed(2)).toBe(i.amountDue.toFixed(2));
  });

  it("يرفض المدخلات غير الصحيحة", () => {
    expect(() => computeContract({ ...base, durationMonths: 0, billingCycle: "MONTHLY", monthlyPrices: ["1"] })).toThrow();
    expect(() => computeContract({ ...base, durationMonths: 12, billingCycle: "MONTHLY", monthlyPrices: [] })).toThrow();
    expect(() => computeContract({ ...base, durationMonths: 1, billingCycle: "MONTHLY", monthlyPrices: ["100"], discount: "101" })).toThrow(/الخصم/);
  });

  it("نهاية العقد والسعر الافتراضي", () => {
    expect(contractEndDate("2026-01-31", 1)).toBe("2026-02-27");
    expect(contractEndDate("2026-03-01", 12)).toBe("2027-02-28");
    expect(defaultMonthlyPrice("12000", "YEAR")?.toFixed(2)).toBe("1000.00");
    expect(defaultMonthlyPrice("500", "MONTH", 3)?.toFixed(2)).toBe("1500.00");
    expect(defaultMonthlyPrice("50", "HOUR")).toBeNull();
  });
});
