import { describe, expect, it } from "vitest";
import { addMonthsKeepDay, installmentPeriods, isOverdue } from "@/lib/dates";
import { splitVatInclusive } from "@/lib/money";

describe("الضريبة: الإيجار شامل ضريبة 15%", () => {
  it("يفصل الضريبة بدقة ومجموعها يساوي المبلغ الشامل", () => {
    const r = splitVatInclusive("1150.00", "0.15");
    expect(r.net.toFixed(2)).toBe("1000.00");
    expect(r.vat.toFixed(2)).toBe("150.00");
  });
  it("مبالغ غير قابلة للقسمة لا تفقد هللة", () => {
    for (const g of ["1000.00", "2500.00", "3333.33", "0.01", "99999.99"]) {
      const r = splitVatInclusive(g, "0.15");
      expect(r.net.plus(r.vat).toFixed(2)).toBe(g);
    }
    expect(splitVatInclusive("1000.00", "0.15").net.toFixed(2)).toBe("869.57");
  });
  it("يرفض النسب والمبالغ غير الصحيحة", () => {
    expect(() => splitVatInclusive("-1", "0.15")).toThrow();
    expect(() => splitVatInclusive("100", "1.5")).toThrow();
  });
});

describe("الاستحقاق: نفس يوم بداية العقد من كل شهر", () => {
  it("عقد يبدأ يوم 12 يستحق يوم 12 من كل شهر", () => {
    const p = installmentPeriods("2026-01-12", "2027-01-11", 1);
    expect(p).toHaveLength(12);
    expect(p.map((x) => x.dueDate.slice(8))).toEqual(Array(12).fill("12"));
    expect(p[0]).toEqual({ seqNo: 1, periodStart: "2026-01-12", periodEnd: "2026-02-11", dueDate: "2026-01-12" });
    expect(p[11]!.periodEnd).toBe("2027-01-11");
  });
  it("الدورات الربعية والنصفية والسنوية", () => {
    expect(installmentPeriods("2026-03-05", "2027-03-04", 3).map((x) => x.dueDate)).toEqual(["2026-03-05", "2026-06-05", "2026-09-05", "2026-12-05"]);
    expect(installmentPeriods("2026-03-05", "2027-03-04", 6)).toHaveLength(2);
    expect(installmentPeriods("2026-03-05", "2027-03-04", 12)).toHaveLength(1);
  });
  it("يوم 31 في الأشهر الأقصر يصبح آخر يوم في الشهر ثم يعود إلى 31", () => {
    expect(addMonthsKeepDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKeepDay("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsKeepDay("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsKeepDay("2026-11-15", 3)).toBe("2027-02-15");
  });
  it("الفترة الأخيرة الجزئية تنتهي بنهاية العقد", () => {
    const p = installmentPeriods("2026-01-12", "2026-03-20", 1);
    expect(p.map((x) => x.periodEnd)).toEqual(["2026-02-11", "2026-03-11", "2026-03-20"]);
  });
});

describe("التأخير: بدون مهلة سماح", () => {
  it("يوم الاستحقاق نفسه غير متأخر، ومن اليوم التالي متأخر", () => {
    expect(isOverdue("2026-11-12", "2026-11-11")).toBe(false);
    expect(isOverdue("2026-11-12", "2026-11-12")).toBe(false);
    expect(isOverdue("2026-11-12", "2026-11-13")).toBe(true);
  });
});
