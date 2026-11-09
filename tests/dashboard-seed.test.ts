import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor, makeUnit, makeTenant, makeContract, linkUnit, branchByCode } from "./helpers";
import { getDashboardStats } from "@/services/dashboard.service";
import { seedReferenceData, INITIAL_BRANCHES } from "../prisma/seed-data";
import { ROLE_KEYS, ALL_PERMISSIONS } from "@/lib/rbac/permissions";
import { addDays, dateOnly, todayInRiyadh } from "@/lib/dates";
import { formatSAR, money, sum } from "@/lib/money";

describe("البيانات المرجعية", () => {
  it("الزرع قابل للتكرار ولا ينشئ مستخدمين", async () => {
    const usersBefore = await prisma.user.count();
    await seedReferenceData(prisma);
    await seedReferenceData(prisma);
    expect(INITIAL_BRANCHES).toHaveLength(11);
    expect(await prisma.branch.count({ where: { code: { in: INITIAL_BRANCHES.map((b) => b.code) } } })).toBe(11);
    expect(await prisma.branch.count({ where: { code: { in: INITIAL_BRANCHES.map((b) => b.code) }, status: "ACTIVE" } })).toBe(7);
    expect(await prisma.branch.count({ where: { code: { in: INITIAL_BRANCHES.map((b) => b.code) }, status: "PREPARING" } })).toBe(4);
    const imu = await prisma.branch.findUniqueOrThrow({ where: { code: "IMU" } });
    expect(imu).toMatchObject({ nameAr: "جامعة الإمام", managerName: "حنان", managerActing: true, phone: "0500510051" });
    const grn = await prisma.branch.findUniqueOrThrow({ where: { code: "GRN" } });
    expect(grn).toMatchObject({ status: "PREPARING", managerName: null });
    expect(await prisma.role.count()).toBe(ROLE_KEYS.length);
    expect(await prisma.permission.count()).toBe(ALL_PERMISSIONS.length);
    expect(await prisma.user.count()).toBe(usersBefore);
  });
});

describe("المبالغ", () => {
  it("حسابات Decimal دقيقة بدون أخطاء الفاصلة العائمة", () => {
    expect(sum(["0.10", "0.20"]).toFixed(2)).toBe("0.30");
    expect(money("10.005").toFixed(2)).toBe("10.01");
    expect(formatSAR("1234567.5")).toBe("1,234,567.50 ر.س");
  });
});

describe("لوحة التحكم", () => {
  it("تحسب المؤشرات من البيانات الحقيقية ومقيدة بفروع المستخدم", async () => {
    // فرع معزول لهذا الاختبار حتى لا تتأثر الأرقام باختبارات أخرى
    const branch = await prisma.branch.create({ data: { code: `X${randomUUID().slice(0, 5)}`, nameAr: `فرع اختبار ${randomUUID().slice(0, 5)}` } });
    const role = await prisma.role.findUniqueOrThrow({ where: { key: "BRANCH_MANAGER" } });
    const { actor: base } = await makeActor("BRANCH_MANAGER");
    const actor = { ...base, branchIds: [branch.id], roleId: role.id };

    const empty = await getDashboardStats(prisma, actor);
    expect(empty.units).toBe(0);
    expect(empty.occupancyPct).toBeNull();
    expect(empty.dueAmount).toBe("0.00");

    const type = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } });
    const units = await Promise.all(
      [1, 2, 3, 4].map((i) => prisma.unit.create({ data: { branchId: branch.id, unitTypeId: type.id, code: `U${i}`, basePrice: "1000" } })),
    );
    const today = todayInRiyadh();
    const t = await makeTenant();
    const c = await makeContract({ branchId: branch.id, tenantId: t.id, start: addDays(today, -60), end: addDays(today, 20) });
    await linkUnit(c.id, units[0]!, addDays(today, -60), addDays(today, 20));

    const sched = (seqNo: number, due: string, amountDue: string, paid = "0") =>
      prisma.paymentSchedule.create({
        data: { contractId: c.id, seqNo, periodStart: dateOnly(due), periodEnd: dateOnly(due), dueDate: dateOnly(due), netAmount: amountDue, amountDue, amountPaid: paid, status: paid === "0" ? "PENDING" : "PARTIAL" },
      });
    await sched(1, addDays(today, -30), "1000.00", "400.00"); // متأخر 600
    await sched(2, today, "1000.00"); // مستحق اليوم 1000 (ليس متأخرًا)
    await sched(3, addDays(today, 10), "1000.00"); // مستقبلي

    await prisma.payment.create({
      data: { tenantId: t.id, contractId: c.id, branchId: branch.id, amount: "400.00", method: "CASH", paidOn: dateOnly(today), idempotencyKey: randomUUID(), status: "APPROVED", approvedAt: new Date(), receiptNo: `R-${randomUUID().slice(0, 8)}` },
    });
    // دفعة غير معتمدة لا تُحتسب
    await prisma.payment.create({
      data: { tenantId: t.id, branchId: branch.id, amount: "999.00", method: "CASH", paidOn: dateOnly(today), idempotencyKey: randomUUID() },
    });

    const s = await getDashboardStats(prisma, actor);
    expect(s.units).toBe(4);
    expect(s.rentedUnits).toBe(1);
    expect(s.occupancyPct).toBe(25);
    expect(s.activeContracts).toBe(1);
    expect(s.expiringContracts).toBe(1);
    expect(s.overdueAmount).toBe("600.00");
    expect(s.dueAmount).toBe("1600.00");
    expect(s.collectedThisMonth).toBe("400.00");

    // مدير فرع آخر لا يرى هذه الأرقام
    const { actor: other } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    const o = await getDashboardStats(prisma, other);
    expect(o.activeContracts).toBe(0);
    expect(o.collectedThisMonth).toBe("0.00");
    void (await branchByCode("TBK"));
  });
});
