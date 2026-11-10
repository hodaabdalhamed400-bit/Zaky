import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor } from "./helpers";
import { approveContract, createContract, submitForApproval } from "@/services/contracts.service";
import { createUnit } from "@/services/units.service";
import { buildPaymentReminder, logWhatsAppReminder, toWhatsAppNumber, upcomingInstallments } from "@/services/reminders.service";
import { addDays, addMonthsKeepDay, todayInRiyadh } from "@/lib/dates";

const TODAY = todayInRiyadh();

async function setup(opts: { start: string; mobile?: string | null }) {
  const code = `W${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "Y")}`;
  const branch = await prisma.branch.create({ data: { code, nameAr: `فرع تذكير ${randomUUID().slice(0, 6)}` } });
  const { actor: admin } = await makeActor("SUPER_ADMIN");
  const type = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } });
  const unit = await createUnit(prisma, admin, { branchId: branch.id, unitTypeId: type.id, code: "101", capacity: "1", basePrice: "2500", pricingCycle: "MONTH", status: "AVAILABLE" });
  const tenant = await prisma.tenant.create({
    data: { type: "COMPANY", name: `شركة التذكير ${randomUUID().slice(0, 4)}`, primaryBranchId: branch.id, mobile: opts.mobile === undefined ? "0551234567" : opts.mobile },
  });
  const c = await createContract(prisma, admin, { tenantId: tenant.id, branchId: branch.id, startDate: opts.start, durationMonths: 12, billingCycle: "MONTHLY", units: [{ unitId: unit.id, monthlyPrice: "2500" }] });
  await submitForApproval(prisma, admin, c.id);
  await approveContract(prisma, admin, c.id);
  return { branch, admin, contract: c, tenant };
}

describe("تذكير الدفع عبر واتساب (مجاني ويدوي)", () => {
  it("تحويل أرقام الجوال السعودية إلى صيغة wa.me", () => {
    expect(toWhatsAppNumber("0551234567")).toBe("966551234567");
    expect(toWhatsAppNumber("055 123 4567")).toBe("966551234567");
    expect(toWhatsAppNumber("٠٥٥١٢٣٤٥٦٧")).toBe("966551234567");
    expect(toWhatsAppNumber("+966551234567")).toBe("966551234567");
    expect(toWhatsAppNumber("00966551234567")).toBe("966551234567");
    expect(toWhatsAppNumber("9660551234567")).toBe("966551234567");
    expect(toWhatsAppNumber("551234567")).toBe("966551234567");
    expect(toWhatsAppNumber("123")).toBeNull();
    expect(toWhatsAppNumber(null)).toBeNull();
  });

  it("عقد متأخر: الرسالة تذكر إجمالي المتأخر ورقم العقد والفرع، والرابط إلى wa.me", async () => {
    const { admin, contract, branch, tenant } = await setup({ start: addMonthsKeepDay(TODAY, -2) });
    const r = await buildPaymentReminder(prisma, admin, contract.id);
    expect(r.kind).toBe("OVERDUE");
    expect(r.amount.toFixed(2)).toBe("5000.00"); // قسطان متأخران × 2500
    expect(r.text).toContain(tenant.name);
    expect(r.text).toContain(contract.contractNo);
    expect(r.text).toContain(branch.nameAr);
    expect(r.text).toContain("5,000.00 ر.س");
    expect(r.text).toContain("قسطان");
    expect(r.text).toContain("0500510051"); // الرقم الموحد من الإعدادات
    expect(r.url.startsWith("https://wa.me/966551234567?text=")).toBe(true);
    expect(decodeURIComponent(r.url.split("text=")[1]!)).toBe(r.text);
  });

  it("قسط قادم بلا متأخرات: الرسالة تذكر رقم القسط وتاريخه", async () => {
    const { admin, contract } = await setup({ start: addDays(TODAY, 3) });
    const r = await buildPaymentReminder(prisma, admin, contract.id);
    expect(r.kind).toBe("UPCOMING");
    expect(r.amount.toFixed(2)).toBe("2500.00");
    expect(r.text).toContain("القسط رقم 1");
    const up = await upcomingInstallments(prisma, admin, { days: 7 });
    expect(up.some((u) => u.contract.id === contract.id && u.daysLeft === 3)).toBe(true);
  });

  it("متأخر + قسط اليوم: الرسالة تذكر الاثنين", async () => {
    const { admin, contract } = await setup({ start: addMonthsKeepDay(TODAY, -1) });
    const r = await buildPaymentReminder(prisma, admin, contract.id);
    expect(r.kind).toBe("OVERDUE");
    expect(r.amount.toFixed(2)).toBe("2500.00");
    expect(r.text).toContain("بالإضافة إلى القسط رقم 2");
    expect(r.text).toContain("المستحق اليوم");
  });

  it("قسط مستحق اليوم", async () => {
    const { admin, contract } = await setup({ start: TODAY });
    expect((await buildPaymentReminder(prisma, admin, contract.id)).kind).toBe("DUE_TODAY");
  });

  it("بدون رقم جوال: رسالة خطأ واضحة", async () => {
    const { admin, contract } = await setup({ start: addMonthsKeepDay(TODAY, -1), mobile: null });
    await expect(buildPaymentReminder(prisma, admin, contract.id)).rejects.toThrow(/رقم جوال/);
  });

  it("يُسجَّل في سجل التدقيق، ولا يصل إليه مستخدم من فرع آخر", async () => {
    const { admin, contract } = await setup({ start: addMonthsKeepDay(TODAY, -1) });
    await logWhatsAppReminder(prisma, admin, contract.id);
    const log = await prisma.auditLog.findFirst({ where: { action: "reminder.whatsapp", entityId: contract.id } });
    expect(log?.userId).toBe(admin.id);
    expect(log?.after).toMatchObject({ kind: "OVERDUE", amount: "2500.00" });
    const { actor: other } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    await expect(buildPaymentReminder(prisma, other, contract.id)).rejects.toThrow();
  });
});
