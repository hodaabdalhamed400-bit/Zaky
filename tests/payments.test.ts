import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor } from "./helpers";
import { approveContract, createContract, submitForApproval, terminateContract } from "@/services/contracts.service";
import { createUnit } from "@/services/units.service";
import { approvePayment, createAdjustment, getPayment, listPayments, recordPayment, rejectPayment, reversePayment } from "@/services/payments.service";
import { getFinanceSummary, overdueReport } from "@/services/finance.service";
import { addDays, todayInRiyadh } from "@/lib/dates";
import { addMonthsKeepDay } from "@/lib/dates";

const TODAY = todayInRiyadh();

/** فرع معزول + عقد معتمد شهري 2500 ر.س × 12، يبدأ قبل شهرين (قسطان متأخران وقسط اليوم إن وافق) */
async function setup(opts: { start?: string; monthly?: string } = {}) {
  const code = `P${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "Y")}`;
  const branch = await prisma.branch.create({ data: { code, nameAr: `فرع تحصيل ${randomUUID().slice(0, 6)}` } });
  const { actor: admin } = await makeActor("SUPER_ADMIN");
  const type = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } });
  const unit = await createUnit(prisma, admin, { branchId: branch.id, unitTypeId: type.id, code: "101", capacity: "1", basePrice: "2500", pricingCycle: "MONTH", status: "AVAILABLE" });
  const tenant = await prisma.tenant.create({ data: { type: "COMPANY", name: `مستأجر ${randomUUID().slice(0, 6)}`, primaryBranchId: branch.id } });
  const start = opts.start ?? addMonthsKeepDay(TODAY, -2);
  const c = await createContract(prisma, admin, { tenantId: tenant.id, branchId: branch.id, startDate: start, durationMonths: 12, billingCycle: "MONTHLY", units: [{ unitId: unit.id, monthlyPrice: opts.monthly ?? "2500" }] });
  await submitForApproval(prisma, admin, c.id);
  await approveContract(prisma, admin, c.id);
  const s = await prisma.paymentSchedule.findMany({ where: { contractId: c.id }, orderBy: { seqNo: "asc" } });
  return { branch, admin, contract: c, s, tenant };
}

const pay = (contractId: string, allocations: { scheduleId: string; amount: string }[], over: Record<string, unknown> = {}) => ({
  contractId,
  amount: allocations.reduce((a, x) => a + Number(x.amount), 0).toFixed(2),
  method: "CASH",
  paidOn: TODAY,
  idempotencyKey: randomUUID(),
  allocations,
  ...over,
});
const sched = (id: string) => prisma.paymentSchedule.findUniqueOrThrow({ where: { id } });

describe("تسجيل واعتماد الدفعات", () => {
  it("دفعة جزئية: لا تُحتسب قبل الاعتماد، وبعده يصبح القسط مسددًا جزئيًا بإيصال من تسلسل الفرع", async () => {
    const { admin, contract, s, branch } = await setup();
    const p = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1000" }]));
    expect(p.status).toBe("PENDING_REVIEW");
    expect(p.receiptNo).toBeNull();
    expect((await sched(s[0]!.id)).amountPaid.toFixed(2)).toBe("0.00");
    const a = await approvePayment(prisma, admin, p.id);
    expect(a.receiptNo).toBe(`RC-${branch.code}-${TODAY.slice(0, 4)}-00001`);
    const after = await sched(s[0]!.id);
    expect(after.amountPaid.toFixed(2)).toBe("1000.00");
    expect(after.status).toBe("PARTIAL");
    await expect(approvePayment(prisma, admin, p.id)).rejects.toThrow(/ليست بانتظار/);
  });

  it("دفعة كاملة موزعة على أكثر من قسط باختيار الموظف", async () => {
    const { admin, contract, s } = await setup();
    const p1 = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1000" }]));
    await approvePayment(prisma, admin, p1.id);
    const p2 = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1500" }, { scheduleId: s[1]!.id, amount: "2500" }], { method: "BANK_TRANSFER", referenceNo: `TRX-${randomUUID().slice(0, 6)}` }));
    const a2 = await approvePayment(prisma, admin, p2.id);
    expect(a2.receiptNo?.endsWith("-00002")).toBe(true);
    expect((await sched(s[0]!.id)).status).toBe("PAID");
    expect((await sched(s[1]!.id)).status).toBe("PAID");
  });

  it("تسلسل الإيصالات مستقل لكل فرع", async () => {
    const A = await setup();
    const B = await setup();
    const pa = await recordPayment(prisma, A.admin, pay(A.contract.id, [{ scheduleId: A.s[0]!.id, amount: "100" }]));
    const pb = await recordPayment(prisma, B.admin, pay(B.contract.id, [{ scheduleId: B.s[0]!.id, amount: "100" }]));
    expect((await approvePayment(prisma, A.admin, pa.id)).receiptNo).toMatch(new RegExp(`^RC-${A.branch.code}-\\d{4}-00001$`));
    expect((await approvePayment(prisma, B.admin, pb.id)).receiptNo).toMatch(new RegExp(`^RC-${B.branch.code}-\\d{4}-00001$`));
  });

  it("لا دفع زائد: المجموع يساوي المبلغ، ولا يتجاوز المتاح، والمعلق محسوب", async () => {
    const { admin, contract, s } = await setup();
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1000" }], { amount: "1200" }))).rejects.toThrow(/لا يوجد دفع زائد/);
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "2500.01" }]))).rejects.toThrow(/المتاح للسداد 2500.00/);
    await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "2000" }]));
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1000" }]))).rejects.toThrow(/المتاح للسداد 500.00.*بانتظار المراجعة/);
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "500" }]))).resolves.toBeTruthy();
  });

  it("منع تكرار نفس عملية الدفع ونفس النموذج", async () => {
    const { admin, contract, s } = await setup();
    const ref = `SA-${randomUUID().slice(0, 8)}`;
    const first = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "100" }], { method: "BANK_TRANSFER", referenceNo: ref }));
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[1]!.id, amount: "100" }], { method: "BANK_TRANSFER", referenceNo: ` ${ref.toLowerCase()} ` }))).rejects.toThrow(/مسجلة مسبقًا/);
    const key = randomUUID();
    await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[2]!.id, amount: "100" }], { idempotencyKey: key }));
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[3]!.id, amount: "100" }], { idempotencyKey: key }))).rejects.toThrow(/تم استلام هذا النموذج/);
    // رفض الأولى يحرر رقم المرجع لإعادة التسجيل الصحيح
    await rejectPayment(prisma, admin, first.id, "مبلغ خاطئ");
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "150" }], { method: "BANK_TRANSFER", referenceNo: ref }))).resolves.toBeTruthy();
  });

  it("التحقق من المدخلات: مرجع التحويل مطلوب، ولا تاريخ مستقبلي، ولا قسط من عقد آخر", async () => {
    const { admin, contract, s } = await setup();
    const other = await setup();
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "100" }], { method: "BANK_TRANSFER" }))).rejects.toThrow(/رقم المرجع مطلوب/);
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "100" }], { paidOn: addDays(TODAY, 1) }))).rejects.toThrow(/المستقبل/);
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: other.s[0]!.id, amount: "100" }]))).rejects.toThrow(/لا يتبع هذا العقد/);
  });

  it("التزامن: دفعتان لنفس القسط في نفس اللحظة لا تتجاوزان المتبقي", async () => {
    const { admin, contract, s } = await setup();
    const res = await Promise.allSettled([0, 1, 2, 3].map(() => recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "2500" }]))));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const ok = res.find((r): r is PromiseFulfilledResult<NonNullable<Awaited<ReturnType<typeof recordPayment>>>> => r.status === "fulfilled")!.value!;
    const approvals = await Promise.allSettled([approvePayment(prisma, admin, ok.id), approvePayment(prisma, admin, ok.id)]);
    expect(approvals.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await sched(s[0]!.id)).amountPaid.toFixed(2)).toBe("2500.00");
  });

  it("العكس: يستبعد الدفعة من المسدد ويحتفظ بالإيصال، ويتطلب صلاحية التسويات", async () => {
    const { admin, contract, s, branch } = await setup();
    const p = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "2500" }]));
    await approvePayment(prisma, admin, p.id);
    const bm = { ...(await makeActor("BRANCH_MANAGER")).actor, branchIds: [branch.id] };
    await expect(reversePayment(prisma, bm, p.id, "خطأ في الإدخال")).rejects.toThrow(/صلاحية/);
    const r = await reversePayment(prisma, admin, p.id, "شيك مرتجع من البنك");
    expect(r.status).toBe("REVERSED");
    expect(r.receiptNo).not.toBeNull();
    const after = await sched(s[0]!.id);
    expect(after.amountPaid.toFixed(2)).toBe("0.00");
    expect(after.status).toBe("PENDING");
    await expect(prisma.payment.delete({ where: { id: p.id } })).rejects.toThrow(/ZAKI_IMMUTABLE/);
  });

  it("الأقساط الملغاة بالإنهاء المبكر لا يمكن السداد عليها", async () => {
    const { admin, contract, s } = await setup();
    await terminateContract(prisma, admin, contract.id, { exitDate: TODAY, reason: "خروج بالاتفاق", policy: "CANCEL_FUTURE" });
    const last = s.at(-1)!;
    expect((await sched(last.id)).status).toBe("CANCELLED");
    await expect(recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: last.id, amount: "100" }]))).rejects.toThrow(/غير قابل للسداد/);
  });
});

describe("التسويات", () => {
  it("إعفاء باقي القسط يغلقه، ولا رسوم تأخير، ولا تتجاوز المتبقي", async () => {
    const { admin, contract, s } = await setup();
    const p = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "2000" }]));
    await approvePayment(prisma, admin, p.id);
    await expect(createAdjustment(prisma, admin, { scheduleId: s[0]!.id, type: "LATE_FEE", amount: "50", reason: "رسوم تأخير" })).rejects.toThrow(/نوع التسوية/);
    await expect(createAdjustment(prisma, admin, { scheduleId: s[0]!.id, type: "WRITE_OFF", amount: "500.01", reason: "تجاوز المتبقي" })).rejects.toThrow(/تتجاوز المتبقي/);
    await createAdjustment(prisma, admin, { scheduleId: s[0]!.id, type: "WRITE_OFF", amount: "500", reason: "إعفاء بموافقة الإدارة" });
    expect((await sched(s[0]!.id)).status).toBe("PAID");
    await createAdjustment(prisma, admin, { scheduleId: s[1]!.id, type: "DISCOUNT", amount: "2500", reason: "خصم شهر مجاني" });
    expect((await sched(s[1]!.id)).status).toBe("WAIVED");
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    await expect(createAdjustment(prisma, bm, { scheduleId: s[2]!.id, type: "DISCOUNT", amount: "1", reason: "محاولة غير مخولة" })).rejects.toThrow(/صلاحية/);
    const adj = await prisma.adjustment.findFirstOrThrow({ where: { scheduleId: s[0]!.id } });
    await expect(prisma.adjustment.delete({ where: { id: adj.id } })).rejects.toThrow(/ZAKI_APPEND_ONLY/);
  });
});

describe("المتأخرات والتقارير", () => {
  it("حساب المتأخرات بدقة: يوم الاستحقاق نفسه ليس متأخرًا", async () => {
    const start = addMonthsKeepDay(TODAY, -2); // أقساط: قبل شهرين، قبل شهر، اليوم
    const { admin, contract, s, branch } = await setup({ start });
    const p = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1000" }]));
    await approvePayment(prisma, admin, p.id);
    const rows = await overdueReport(prisma, admin, { branchId: branch.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.overdue).toBe("4000.00"); // 1500 + 2500
    expect(rows[0]!.installments).toBe(2);
    expect(rows[0]!.oldestDue.toISOString().slice(0, 10)).toBe(start);
    const sum = await getFinanceSummary(prisma, admin, { branchId: branch.id });
    expect(sum.overdue).toBe("4000.00");
    expect(sum.due).toBe("6500.00"); // + قسط اليوم
    expect(sum.future).toBe(String((9 * 2500).toFixed(2)));
    expect(sum.contractValue).toBe("30000.00");
    expect(sum.collected.current).toBe("1000.00");
  });

  it("الملخص: المعلق منفصل، والإيراد المحاسبي صافٍ بدون ضريبة وموزع على الأيام", async () => {
    const month = TODAY.slice(0, 7);
    const { admin, contract, s, branch } = await setup({ start: `${month}-01`, monthly: "1150" });
    await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "1150" }]));
    const sum = await getFinanceSummary(prisma, admin, { branchId: branch.id, month });
    expect(sum.pending.count).toBe(1);
    expect(sum.pending.amount).toBe("1150.00");
    expect(sum.collected.current).toBe("0.00");
    expect(sum.revenueNet).toBe("1000.00"); // شهر كامل صافي = 1150 / 1.15
    expect(sum.byMonth).toHaveLength(12);
    expect(sum.byMonth.at(-1)).toMatchObject({ month, billed: "1150.00", collected: "0.00" });
  });

  it("الصلاحيات حسب الفرع", async () => {
    const { admin, contract, s } = await setup();
    const p = await recordPayment(prisma, admin, pay(contract.id, [{ scheduleId: s[0]!.id, amount: "100" }]));
    const { actor: other } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    await expect(getPayment(prisma, other, p.id)).rejects.toThrow(/الفرع/);
    await expect(recordPayment(prisma, other, pay(contract.id, [{ scheduleId: s[1]!.id, amount: "100" }]))).rejects.toThrow(/الفرع/);
    expect((await listPayments(prisma, other, { q: contract.contractNo })).total).toBe(0);
    const { actor: sales } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["TBK"] });
    await expect(listPayments(prisma, sales, {})).rejects.toThrow(/صلاحية/);
  });
});
