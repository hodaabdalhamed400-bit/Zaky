import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeUnit, makeTenant, makeContract, linkUnit, branchByCode } from "./helpers";
import { dateOnly } from "@/lib/dates";

describe("منع تعارض العقود على نفس الوحدة (قيد EXCLUDE في قاعدة البيانات)", () => {
  it("يرفض عقدًا متداخلًا على وحدة حصرية ويقبل الفترات المتتالية", async () => {
    const unit = await makeUnit("GRN");
    const t1 = await makeTenant();
    const t2 = await makeTenant();
    const c1 = await makeContract({ branchId: unit.branchId, tenantId: t1.id, start: "2026-01-01", end: "2026-12-31" });
    await linkUnit(c1.id, unit, "2026-01-01", "2026-12-31");

    const c2 = await makeContract({ branchId: unit.branchId, tenantId: t2.id, start: "2026-06-01", end: "2027-05-31" });
    await expect(linkUnit(c2.id, unit, "2026-06-01", "2027-05-31")).rejects.toThrow(/contract_units_no_overlap|exclusion/i);

    // اليوم الأخير مشترك = تعارض (الفترة مغلقة الطرفين)
    const c3 = await makeContract({ branchId: unit.branchId, tenantId: t2.id, start: "2026-12-31", end: "2027-12-31" });
    await expect(linkUnit(c3.id, unit, "2026-12-31", "2027-12-31")).rejects.toThrow();

    // يبدأ في اليوم التالي = مسموح
    const c4 = await makeContract({ branchId: unit.branchId, tenantId: t2.id, start: "2027-01-01", end: "2027-12-31" });
    await expect(linkUnit(c4.id, unit, "2027-01-01", "2027-12-31")).resolves.toBeTruthy();
  });

  it("المسودات لا تحجز الوحدة (blocks_occupancy=false)", async () => {
    const unit = await makeUnit("GRN");
    const t = await makeTenant();
    const a = await makeContract({ branchId: unit.branchId, tenantId: t.id, start: "2026-01-01", end: "2026-06-30" });
    await linkUnit(a.id, unit, "2026-01-01", "2026-06-30");
    const draft = await makeContract({ branchId: unit.branchId, tenantId: t.id, start: "2026-03-01", end: "2026-04-30", status: "DRAFT" });
    await expect(linkUnit(draft.id, unit, "2026-03-01", "2026-04-30", false)).resolves.toBeTruthy();
  });

  it("الوحدات المشتركة لا يحكمها قيد الحصرية (يحكمها عدد المقاعد في طبقة الخدمات)", async () => {
    const unit = await makeUnit("GRN", "SHARED_OFFICE");
    const t = await makeTenant();
    const a = await makeContract({ branchId: unit.branchId, tenantId: t.id, start: "2026-01-01", end: "2026-06-30" });
    const b = await makeContract({ branchId: unit.branchId, tenantId: t.id, start: "2026-01-01", end: "2026-06-30" });
    await linkUnit(a.id, unit, "2026-01-01", "2026-06-30");
    await expect(linkUnit(b.id, unit, "2026-01-01", "2026-06-30")).resolves.toBeTruthy();
  });

  it("التزامن: إدخالان متعارضان في نفس اللحظة — ينجح واحد فقط", async () => {
    const unit = await makeUnit("GRN");
    const t = await makeTenant();
    const contracts = await Promise.all(
      Array.from({ length: 5 }, () => makeContract({ branchId: unit.branchId, tenantId: t.id, start: "2028-01-01", end: "2028-12-31" })),
    );
    const results = await Promise.allSettled(contracts.map((c) => linkUnit(c.id, unit, "2028-01-01", "2028-12-31")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(4);
  });

  it("يرفض عقدًا تاريخ نهايته قبل بدايته", async () => {
    const t = await makeTenant();
    const grn = await branchByCode("GRN");
    await expect(makeContract({ branchId: grn.id, tenantId: t.id, start: "2026-05-01", end: "2026-04-01" })).rejects.toThrow(/contracts_dates_valid/);
  });
});

async function makePayment(opts: { ref?: string | null; method?: "BANK_TRANSFER" | "CASH"; amount?: string; approved?: boolean }) {
  const t = await makeTenant();
  const grn = await branchByCode("GRN");
  return prisma.payment.create({
    data: {
      tenantId: t.id,
      branchId: grn.id,
      amount: opts.amount ?? "500.00",
      method: opts.method ?? "BANK_TRANSFER",
      referenceNo: opts.ref ?? null,
      paidOn: dateOnly("2026-11-01"),
      idempotencyKey: randomUUID(),
      ...(opts.approved ? { status: "APPROVED", approvedAt: new Date(), receiptNo: `R-${randomUUID().slice(0, 8)}` } : {}),
    },
  });
}

describe("سلامة السجلات المالية", () => {
  it("يمنع تسجيل نفس عملية الدفع مرتين (نفس الوسيلة ورقم المرجع، بغض النظر عن حالة الأحرف والمسافات)", async () => {
    const ref = `TRX-${randomUUID().slice(0, 8)}`;
    await makePayment({ ref });
    await expect(makePayment({ ref: ` ${ref.toLowerCase()} ` })).rejects.toThrow(/payments_method_reference_unique|Unique/i);
    // نفس الرقم بوسيلة مختلفة مسموح
    await expect(makePayment({ ref, method: "CASH" })).resolves.toBeTruthy();
  });

  it("يرفض المبالغ الصفرية أو السالبة", async () => {
    await expect(makePayment({ amount: "0" })).rejects.toThrow(/payments_amount_positive/);
    await expect(makePayment({ amount: "-10" })).rejects.toThrow(/payments_amount_positive/);
  });

  it("الدفعة المعتمدة لا تُحذف ولا يُعدَّل مبلغها", async () => {
    const p = await makePayment({ approved: true });
    await expect(prisma.payment.delete({ where: { id: p.id } })).rejects.toThrow(/ZAKI_IMMUTABLE/);
    await expect(prisma.payment.update({ where: { id: p.id }, data: { amount: "1.00" } })).rejects.toThrow(/ZAKI_IMMUTABLE/);
    // العكس عبر حالة REVERSED هو المسار الوحيد المسموح
    await expect(prisma.payment.update({ where: { id: p.id }, data: { status: "REVERSED", reversedAt: new Date(), reversalReason: "خطأ إدخال" } })).resolves.toBeTruthy();
  });

  it("لا يمكن اعتماد دفعة بدون رقم إيصال", async () => {
    const p = await makePayment({});
    await expect(prisma.payment.update({ where: { id: p.id }, data: { status: "APPROVED", approvedAt: new Date() } })).rejects.toThrow(/payments_approval_consistent/);
  });

  it("لا يتجاوز المسدد قيمة القسط", async () => {
    const t = await makeTenant();
    const grn = await branchByCode("GRN");
    const c = await makeContract({ branchId: grn.id, tenantId: t.id, start: "2026-01-01", end: "2026-12-31" });
    const base = { contractId: c.id, periodStart: dateOnly("2026-01-01"), periodEnd: dateOnly("2026-01-31"), dueDate: dateOnly("2026-01-01"), netAmount: "1000.00", amountDue: "1000.00" };
    await expect(prisma.paymentSchedule.create({ data: { ...base, seqNo: 1, amountPaid: "1000.01" } })).rejects.toThrow(/schedules_amounts_valid/);
    await expect(prisma.paymentSchedule.create({ data: { ...base, seqNo: 2, amountDue: "999.00" } })).rejects.toThrow(/schedules_amounts_valid/);
    await expect(prisma.paymentSchedule.create({ data: { ...base, seqNo: 3, amountPaid: "400.00" } })).resolves.toBeTruthy();
  });
});

describe("سجل التدقيق ونسخ العقود (إضافة فقط)", () => {
  it("يمنع تعديل أو حذف سجل التدقيق", async () => {
    const log = await prisma.auditLog.create({ data: { action: "test.event" } });
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "tampered" } })).rejects.toThrow(/ZAKI_APPEND_ONLY/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/ZAKI_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe("TRUNCATE audit_logs")).rejects.toThrow(/ZAKI_APPEND_ONLY/);
  });

  it("يمنع تعديل نسخة عقد محفوظة", async () => {
    const t = await makeTenant();
    const grn = await branchByCode("GRN");
    const c = await makeContract({ branchId: grn.id, tenantId: t.id, start: "2026-01-01", end: "2026-12-31" });
    const v = await prisma.contractVersion.create({ data: { contractId: c.id, versionNo: 1, snapshot: { total: "12000.00" } } });
    await expect(prisma.contractVersion.update({ where: { id: v.id }, data: { changeReason: "x" } })).rejects.toThrow(/ZAKI_APPEND_ONLY/);
  });
});

describe("قيود أخرى", () => {
  it("البريد يُخزَّن بأحرف صغيرة فقط", async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "READ_ONLY" } });
    await expect(prisma.user.create({ data: { email: "Upper@Test.sa", name: "x", passwordHash: "x", roleId: role.id } })).rejects.toThrow(/users_email_lowercase/);
  });

  it("رمز الوحدة فريد داخل الفرع", async () => {
    const u = await makeUnit("GRN");
    await expect(prisma.unit.create({ data: { branchId: u.branchId, unitTypeId: u.unitTypeId, code: u.code, basePrice: "1" } })).rejects.toThrow(/Unique/i);
  });

  it("المستند يجب أن يرتبط بكيان", async () => {
    await expect(
      prisma.document.create({ data: { category: "OTHER", fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, storageKey: randomUUID(), sha256: "x" } }),
    ).rejects.toThrow(/documents_has_owner/);
  });
});
