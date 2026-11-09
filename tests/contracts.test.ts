import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor, branchByCode } from "./helpers";
import {
  approveContract, cancelContract, createContract, createRenewalDraft, getContract, listContracts, rejectContract,
  runContractMaintenance, submitForApproval, terminateContract, updateDraft, updateTerms,
} from "@/services/contracts.service";
import { createUnit } from "@/services/units.service";
import { computeOccupancy } from "@/services/occupancy.service";
import { addDays, todayInRiyadh } from "@/lib/dates";
import { contractEndDate } from "@/lib/contract-pricing";

async function setup(opts: { branchCode?: string } = {}) {
  const code = opts.branchCode ?? `C${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
  const branch = opts.branchCode ? await branchByCode(code) : await prisma.branch.create({ data: { code, nameAr: `فرع عقود ${randomUUID().slice(0, 6)}` } });
  const { actor: admin } = await makeActor("SUPER_ADMIN");
  const type = (k: string) => prisma.unitType.findUniqueOrThrow({ where: { key: k } }).then((t) => t.id);
  const mk = async (c: string, over: Record<string, unknown> = {}) =>
    createUnit(prisma, admin, { branchId: branch.id, unitTypeId: await type("PRIVATE_OFFICE"), code: c, capacity: "1", basePrice: "1150", pricingCycle: "MONTH", status: "AVAILABLE", areaSqm: "20", ...over });
  const tenant = await prisma.tenant.create({ data: { type: "COMPANY", name: `مستأجر ${randomUUID().slice(0, 6)}`, primaryBranchId: branch.id } });
  return { branch, admin, mk, tenant, type };
}

const input = (b: { id: string }, t: { id: string }, units: { unitId: string; monthlyPrice?: string; seats?: number }[], over: Record<string, unknown> = {}) => ({
  tenantId: t.id,
  branchId: b.id,
  startDate: "2026-01-12",
  durationMonths: 12,
  billingCycle: "MONTHLY",
  units: units.map((u) => ({ monthlyPrice: "1150", seats: 1, ...u })),
  ...over,
});

async function activate(admin: Parameters<typeof approveContract>[1], id: string) {
  await submitForApproval(prisma, admin, id);
  return approveContract(prisma, admin, id);
}

describe("دورة العقد", () => {
  it("إنشاء عقد بأكثر من وحدة وترقيمه وفق النمط المعتمد", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const [a, b] = [await mk("101"), await mk("102")];
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: a.id }, { unitId: b.id, monthlyPrice: "2,300" }]));
    expect(c.contractNo).toMatch(new RegExp(`^ZK-${branch.code}-\\d{4}-0001$`));
    expect(c.status).toBe("DRAFT");
    expect(c.totalAmount.toFixed(2)).toBe("41400.00"); // (1150+2300) × 12
    expect(c.endDate.toISOString().slice(0, 10)).toBe("2027-01-11");
    expect(c.depositAmount.toFixed(2)).toBe("0.00");
    const c2 = await createContract(prisma, admin, input(branch, tenant, [{ unitId: a.id }], { startDate: "2028-01-01" }));
    expect(c2.contractNo.endsWith("-0002")).toBe(true);
  });

  it("الاعتماد ينشئ جدول أقساط صحيحًا (يوم 12 من كل شهر، شامل الضريبة)", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("A1");
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]));
    await activate(admin, c.id);
    const s = await prisma.paymentSchedule.findMany({ where: { contractId: c.id }, orderBy: { seqNo: "asc" } });
    expect(s).toHaveLength(12);
    expect(s.every((x) => x.dueDate.toISOString().slice(8, 10) === "12")).toBe(true);
    expect(s[0]!.amountDue.toFixed(2)).toBe("1150.00");
    expect(s[0]!.vatAmount.toFixed(2)).toBe("150.00");
    const after = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.status).toBe("ACTIVE");
    expect(after.vatAmount.toFixed(2)).toBe("1800.00");
    expect(await prisma.contractVersion.count({ where: { contractId: c.id } })).toBe(1);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe("ACTIVE");
    await expect(approveContract(prisma, admin, c.id)).rejects.toThrow(/ليس بانتظار/);
  });

  it("منع عقد متعارض لنفس الوحدة (في الخدمة وقاعدة البيانات)", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("X1");
    const c1 = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]));
    // مسودتان متداخلتان مسموحتان (لا تحجزان)
    const c2 = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: "2026-06-01" }));
    await submitForApproval(prisma, admin, c1.id);
    await expect(submitForApproval(prisma, admin, c2.id)).rejects.toThrow(/محجوزة في هذه الفترة/);
    await expect(createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: "2026-12-01" }))).rejects.toThrow(new RegExp(c1.contractNo));
    // يبدأ في اليوم التالي للنهاية = مسموح
    const c3 = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: "2027-01-12" }));
    await expect(submitForApproval(prisma, admin, c3.id)).resolves.toBeTruthy();
  });

  it("التزامن: إرسال عقدين متعارضين للاعتماد في نفس اللحظة — ينجح واحد", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("R1");
    const drafts = await Promise.all([0, 1, 2, 3].map(() => createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]))));
    const res = await Promise.allSettled(drafts.map((d) => submitForApproval(prisma, admin, d.id)));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of res.filter((r): r is PromiseRejectedResult => r.status === "rejected")) expect(String(r.reason)).toMatch(/تعارض|محجوزة/);
  });

  it("الوحدة المشتركة: المقاعد لا تتجاوز السعة", async () => {
    const { branch, admin, mk, tenant, type } = await setup();
    const s = await mk("SH", { unitTypeId: await type("SHARED_OFFICE"), capacity: "10" });
    const a = await createContract(prisma, admin, input(branch, tenant, [{ unitId: s.id, seats: 6, monthlyPrice: "3000" }]));
    await submitForApproval(prisma, admin, a.id);
    const b = await createContract(prisma, admin, input(branch, tenant, [{ unitId: s.id, seats: 4, monthlyPrice: "2000" }]));
    await submitForApproval(prisma, admin, b.id);
    await expect(createContract(prisma, admin, input(branch, tenant, [{ unitId: s.id, seats: 1 }]))).rejects.toThrow(/المقاعد المتاحة.*0/);
    await expect(createContract(prisma, admin, input(branch, tenant, [{ unitId: s.id, seats: 11 }]))).rejects.toThrow(/تتجاوز سعتها/);
  });

  it("يرفض وحدات فرع آخر وقاعات الاجتماعات والوحدات غير النشطة", async () => {
    const { branch, admin, mk, tenant, type } = await setup();
    const other = await setup();
    const foreign = await other.mk("F1");
    await expect(createContract(prisma, admin, input(branch, tenant, [{ unitId: foreign.id }]))).rejects.toThrow(/لا تتبع فرع العقد/);
    const room = await mk("MR", { unitTypeId: await type("MEETING_ROOM"), pricingCycle: "HOUR", basePrice: "100" });
    await expect(createContract(prisma, admin, input(branch, tenant, [{ unitId: room.id }]))).rejects.toThrow(/بالحجوزات/);
    const off = await mk("OFF", { status: "INACTIVE" });
    await expect(createContract(prisma, admin, input(branch, tenant, [{ unitId: off.id }]))).rejects.toThrow(/غير متاحة/);
  });

  it("الإرجاع للتعديل، وتعديل المسودة، والإلغاء يحرر الوحدة", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("E1");
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]));
    await submitForApproval(prisma, admin, c.id);
    await expect(updateDraft(prisma, admin, c.id, input(branch, tenant, [{ unitId: u.id }]))).rejects.toThrow(/مسودة/);
    await rejectContract(prisma, admin, c.id, "السعر يحتاج مراجعة");
    const edited = await updateDraft(prisma, admin, c.id, input(branch, tenant, [{ unitId: u.id, monthlyPrice: "1000" }], { discountAmount: "500" }));
    expect(edited.totalAmount.toFixed(2)).toBe("11500.00");
    expect(edited.rejectionReason).toBeNull();
    await submitForApproval(prisma, admin, c.id);
    await cancelContract(prisma, admin, c.id, "العميل اعتذر");
    const free = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]));
    await expect(submitForApproval(prisma, admin, free.id)).resolves.toBeTruthy();
  });

  it("بعد الاعتماد: الشروط فقط قابلة للتعديل مع نسخة جديدة", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("T1");
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]));
    await activate(admin, c.id);
    await expect(updateDraft(prisma, admin, c.id, input(branch, tenant, [{ unitId: u.id, monthlyPrice: "1" }]))).rejects.toThrow(/مسودة/);
    await updateTerms(prisma, admin, c.id, { terms: "شروط جديدة", reason: "طلب العميل" });
    expect(await prisma.contractVersion.count({ where: { contractId: c.id } })).toBe(2);
  });
});

describe("الإنهاء المبكر (حسب الاتفاق لكل عقد)", () => {
  it("إلغاء الأقساط المستقبلية: تُلغى غير المدفوعة بعد تاريخ الخروج، وتتحرر الوحدة بعده", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("TM");
    const today = todayInRiyadh();
    const start = addDays(today, -40);
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: start }));
    await activate(admin, c.id);
    const exit = addDays(today, 10);
    await expect(terminateContract(prisma, admin, c.id, { exitDate: exit, reason: "خروج", policy: "BAD" })).rejects.toThrow(/مصير الأقساط/);
    const r = await terminateContract(prisma, admin, c.id, { exitDate: exit, reason: "انتقال العميل", policy: "CANCEL_FUTURE" });
    const s = await prisma.paymentSchedule.findMany({ where: { contractId: c.id }, orderBy: { seqNo: "asc" } });
    const kept = s.filter((x) => x.status !== "CANCELLED");
    expect(kept.every((x) => x.periodStart.toISOString().slice(0, 10) <= exit)).toBe(true);
    expect(r.cancelledInstallments).toBe(s.length - kept.length);
    expect(r.cancelledInstallments).toBeGreaterThan(5);
    expect(r.contract.status).toBe("TERMINATED");
    // تبقى الوحدة مشغولة حتى تاريخ الخروج ثم تتحرر
    expect((await computeOccupancy(prisma, [branch.id])).get(branch.id).occupiedUnits).toBe(1);
    expect((await computeOccupancy(prisma, [branch.id], addDays(exit, 1))).get(branch.id).occupiedUnits).toBe(0);
    const next = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: addDays(exit, 1) }));
    await expect(submitForApproval(prisma, admin, next.id)).resolves.toBeTruthy();
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).status).toBe("FORMER");
  });

  it("إبقاء الأقساط مستحقة: لا يُلغى أي قسط", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("TK");
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: addDays(todayInRiyadh(), -40) }));
    await activate(admin, c.id);
    const r = await terminateContract(prisma, admin, c.id, { exitDate: todayInRiyadh(), reason: "خروج", policy: "KEEP_DUE" });
    expect(r.cancelledInstallments).toBe(0);
    expect(await prisma.paymentSchedule.count({ where: { contractId: c.id, status: "CANCELLED" } })).toBe(0);
  });

  it("الإنهاء يتطلب صلاحية contracts.terminate (مدير الفرع لا يملكها افتراضيًا)", async () => {
    const { branch, admin, mk, tenant } = await setup({ branchCode: "SWD" });
    const u = await mk(`B${randomUUID().slice(0, 4)}`);
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }], { startDate: "2031-01-01" }));
    await activate(admin, c.id);
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["SWD"] });
    await expect(terminateContract(prisma, bm, c.id, { exitDate: "2031-02-01", reason: "x y z", policy: "KEEP_DUE" })).rejects.toThrow(/صلاحية/);
  });
});

describe("التجديد", () => {
  it("مسودة تجديد مرتبطة بالسابق تبدأ في اليوم التالي، وسعرها قابل للتعديل، ولا تتكرر", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const u = await mk("RN");
    const c = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u.id }]));
    await activate(admin, c.id);
    const r = await createRenewalDraft(prisma, admin, c.id);
    expect(r.previousContractId).toBe(c.id);
    expect(r.startDate.toISOString().slice(0, 10)).toBe("2027-01-12");
    expect(r.endDate.toISOString().slice(0, 10)).toBe(contractEndDate("2027-01-12", 12));
    await expect(createRenewalDraft(prisma, admin, c.id)).rejects.toThrow(/يوجد تجديد/);
    const priced = await updateDraft(prisma, admin, r.id, input(branch, tenant, [{ unitId: u.id, monthlyPrice: "1265" }], { startDate: "2027-01-12" }));
    expect(priced.totalAmount.toFixed(2)).toBe("15180.00");
    await activate(admin, r.id);
    // بعد انتهاء الأصلي: يصبح "مجدد" والوحدة مشغولة بالتجديد دون انقطاع
    const res = await runContractMaintenance(prisma, "2027-01-12");
    expect(res.renewed).toBeGreaterThanOrEqual(1);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("RENEWED");
    expect((await computeOccupancy(prisma, [branch.id], "2027-01-12")).get(branch.id).occupiedUnits).toBe(1);
  });

  it("المهمة اليومية: تنهي العقود المنتهية وتنشئ مسودات التجديد تلقائيًا قبل 30 يومًا", async () => {
    const { branch, admin, mk, tenant } = await setup();
    const today = todayInRiyadh();
    const u1 = await mk("D1");
    const u2 = await mk("D2");
    // ينتهي خلال 20 يومًا → مسودة تجديد
    const soon = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u1.id }], { startDate: addDays(contractEndDate(today, 1), -(30 - 20) + 1 - 30), durationMonths: 1 }));
    // انتهى أمس → منتهي
    const old = await createContract(prisma, admin, input(branch, tenant, [{ unitId: u2.id }], { startDate: "2025-01-01", durationMonths: 1 }));
    await activate(admin, soon.id);
    await activate(admin, old.id);
    const soonEnd = (await prisma.contract.findUniqueOrThrow({ where: { id: soon.id } })).endDate.toISOString().slice(0, 10);
    expect(soonEnd >= today && soonEnd <= addDays(today, 30)).toBe(true);
    const res = await runContractMaintenance(prisma, today);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("EXPIRED");
    const draft = await prisma.contract.findFirst({ where: { previousContractId: soon.id } });
    expect(draft?.status).toBe("DRAFT");
    expect(draft?.createdById).toBeNull();
    expect(res.renewalDrafts).toBeGreaterThanOrEqual(1);
    // التشغيل المتكرر لا يكرر المسودات
    await runContractMaintenance(prisma, today);
    expect(await prisma.contract.count({ where: { previousContractId: soon.id } })).toBe(1);
  });
});

describe("صلاحيات العقود حسب الفرع", () => {
  it("مدير الفرع ينشئ ويعتمد في فرعه فقط، ولا يرى عقود فرع آخر", async () => {
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["NFL"] });
    const nfl = await branchByCode("NFL");
    const ctx = await setup({ branchCode: "NFL" });
    const t = await prisma.tenant.create({ data: { type: "COMPANY", name: `نفل ${randomUUID().slice(0, 5)}`, primaryBranchId: nfl.id } });
    const u = await ctx.mk(`N${randomUUID().slice(0, 5)}`);
    const c = await createContract(prisma, bm, input(nfl, t, [{ unitId: u.id }], { startDate: "2030-03-01" }));
    await submitForApproval(prisma, bm, c.id);
    await approveContract(prisma, bm, c.id);
    const { actor: other } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    await expect(getContract(prisma, other, c.id)).rejects.toThrow(/الفرع/);
    expect((await listContracts(prisma, other, { q: c.contractNo })).total).toBe(0);
    const { actor: sales } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["NFL"] });
    await expect(approveContract(prisma, sales, c.id)).rejects.toThrow(/صلاحية/);
  });
});
