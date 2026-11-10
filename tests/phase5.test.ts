import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { prisma, makeActor, makeUser } from "./helpers";
import { createSession, validateSession } from "@/lib/auth/session";
import { approveContract, createContract, rejectContract, submitForApproval } from "@/services/contracts.service";
import { createUnit } from "@/services/units.service";
import { approvePayment, recordPayment } from "@/services/payments.service";
import { listNotifications, markAllRead, markRead, runNotificationJob, unreadCount } from "@/services/notifications.service";
import { REPORTS, canViewReport, runReport } from "@/services/reports.service";
import { getDashboardCharts } from "@/services/dashboard.service";
import { buildWorkbook } from "@/lib/excel";
import { addDays, addMonthsKeepDay, todayInRiyadh } from "@/lib/dates";
import type { RoleKey } from "@/lib/rbac/permissions";

const TODAY = todayInRiyadh();

async function world() {
  const code = `N${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "Q")}`;
  const branch = await prisma.branch.create({ data: { code, nameAr: `فرع تقارير ${randomUUID().slice(0, 6)}` } });
  const { actor: admin } = await makeActor("SUPER_ADMIN");
  const actorIn = async (role: RoleKey) => {
    const u = await makeUser(role);
    await prisma.userBranchAccess.create({ data: { userId: u.id, branchId: branch.id } });
    const { token } = await createSession(prisma, u.id);
    return (await validateSession(prisma, token))!;
  };
  const type = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } });
  const unit = await createUnit(prisma, admin, { branchId: branch.id, unitTypeId: type.id, code: "N1", capacity: "1", basePrice: "1150", pricingCycle: "MONTH", status: "AVAILABLE", areaSqm: "20" });
  const tenant = await prisma.tenant.create({ data: { type: "COMPANY", name: `شركة التقارير ${randomUUID().slice(0, 5)}`, primaryBranchId: branch.id } });
  const draft = (start: string, months = 12, by = admin) =>
    createContract(prisma, by, { tenantId: tenant.id, branchId: branch.id, startDate: start, durationMonths: months, billingCycle: "MONTHLY", units: [{ unitId: unit.id, monthlyPrice: "1150" }] });
  return { branch, admin, actorIn, unit, tenant, draft };
}

describe("مركز الإشعارات", () => {
  it("عقد بانتظار الاعتماد يصل لمن يملك الاعتماد في الفرع فقط، ويُغلق عند الاعتماد/الإرجاع", async () => {
    const w = await world();
    const bm = await w.actorIn("BRANCH_MANAGER");
    const sales = await w.actorIn("SALES_EMPLOYEE");
    const { actor: otherBm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    const c = await w.draft(addDays(TODAY, 100), 12, sales);
    await submitForApproval(prisma, sales, c.id);
    const bmList = await listNotifications(prisma, bm, {});
    expect(bmList.items.some((n) => n.type === "CONTRACT_PENDING_APPROVAL" && n.entityId === c.id)).toBe(true);
    expect((await listNotifications(prisma, sales, {})).items.some((n) => n.entityId === c.id)).toBe(false);
    expect((await listNotifications(prisma, otherBm, {})).items.some((n) => n.entityId === c.id)).toBe(false);
    await rejectContract(prisma, bm, c.id, "يحتاج تعديل السعر");
    expect(await prisma.notification.count({ where: { entityId: c.id, type: "CONTRACT_PENDING_APPROVAL", readAt: null } })).toBe(0);
  });

  it("دفعة بانتظار المراجعة تصل للمعتمدين ما عدا المسجِّل، وتُغلق بالاعتماد", async () => {
    const w = await world();
    const acc = await w.actorIn("ACCOUNTANT");
    const bm = await w.actorIn("BRANCH_MANAGER");
    const c = await w.draft(addMonthsKeepDay(TODAY, -1));
    await submitForApproval(prisma, w.admin, c.id);
    await approveContract(prisma, w.admin, c.id);
    const s = await prisma.paymentSchedule.findFirstOrThrow({ where: { contractId: c.id, seqNo: 1 } });
    const p = await recordPayment(prisma, bm, { contractId: c.id, amount: "500", method: "CASH", paidOn: TODAY, idempotencyKey: randomUUID(), allocations: [{ scheduleId: s.id, amount: "500" }] });
    expect(await prisma.notification.count({ where: { entityId: p!.id, userId: acc.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { entityId: p!.id, userId: bm.id } })).toBe(0);
    await approvePayment(prisma, acc, p!.id);
    expect(await prisma.notification.count({ where: { entityId: p!.id, readAt: null } })).toBe(0);
  });

  it("المهمة اليومية: انتهاء العقد بعتبات 30/15/7 بلا تكرار، وأقساط مستحقة ومتأخرة، ومستند ناقص", async () => {
    const w = await world();
    const sales = await w.actorIn("SALES_EMPLOYEE");
    const acc = await w.actorIn("ACCOUNTANT");
    const ro = await w.actorIn("READ_ONLY");
    // عقد شهر واحد بدأ قبل 20 يومًا تقريبًا → ينتهي خلال ~10 أيام، وقسطه متأخر
    const c = await w.draft(addDays(TODAY, -20), 1);
    await submitForApproval(prisma, w.admin, c.id);
    await approveContract(prisma, w.admin, c.id);
    await prisma.contract.update({ where: { id: c.id }, data: { approvedAt: new Date(Date.now() - 5 * 86_400_000) } });
    await runNotificationJob(prisma, TODAY);
    await runNotificationJob(prisma, TODAY); // التكرار آمن
    const mine = (u: { id: string }) => prisma.notification.findMany({ where: { userId: u.id, entityId: { in: [c.id] } } });
    const salesN = await mine(sales);
    expect(salesN.filter((n) => n.type === "CONTRACT_EXPIRING")).toHaveLength(1);
    expect(salesN[0]!.dedupeKey).toMatch(/:15$/);
    const sched = await prisma.paymentSchedule.findFirstOrThrow({ where: { contractId: c.id } });
    expect(await prisma.notification.count({ where: { userId: acc.id, type: "PAYMENT_OVERDUE", entityId: sched.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ro.id } })).toBe(0); // اطلاع فقط: لا إجراء مطلوب
    expect(await prisma.notification.count({ where: { type: "DOCUMENT_MISSING", entityId: c.id } })).toBeGreaterThan(0);
    // بعد 6 أيام: عتبة 7 أيام → تنبيه جديد واحد فقط
    await runNotificationJob(prisma, addDays(TODAY, 6));
    expect((await mine(sales)).filter((n) => n.type === "CONTRACT_EXPIRING")).toHaveLength(2);
  });

  it("المستخدم يقرأ تنبيهاته فقط، وروابطها داخلية", async () => {
    const { actor: a } = await makeActor("READ_ONLY", { branchCodes: ["IZD"] });
    const { actor: b } = await makeActor("READ_ONLY", { branchCodes: ["IZD"] });
    const n = await prisma.notification.create({ data: { userId: a.id, type: "SYSTEM", title: "اختبار", link: "https://evil.example", dedupeKey: randomUUID() } });
    await expect(markRead(prisma, b, n.id)).rejects.toThrow(/غير موجود/);
    expect(await markRead(prisma, a, n.id)).toBe("/notifications");
    await prisma.notification.create({ data: { userId: a.id, type: "SYSTEM", title: "٢", dedupeKey: randomUUID() } });
    expect(await unreadCount(prisma, a)).toBe(1);
    await markAllRead(prisma, a);
    expect(await unreadCount(prisma, a)).toBe(0);
  });
});

describe("التقارير والتصدير", () => {
  it("كل التقارير تعمل ومقيدة بفروع المستخدم", async () => {
    const w = await world();
    const c = await w.draft(addMonthsKeepDay(TODAY, -2));
    await submitForApproval(prisma, w.admin, c.id);
    await approveContract(prisma, w.admin, c.id);
    const s = await prisma.paymentSchedule.findFirstOrThrow({ where: { contractId: c.id, seqNo: 1 } });
    const p = await recordPayment(prisma, w.admin, { contractId: c.id, amount: "1150", method: "CASH", paidOn: TODAY, idempotencyKey: randomUUID(), allocations: [{ scheduleId: s.id, amount: "1150" }] });
    await approvePayment(prisma, w.admin, p!.id);
    for (const key of Object.keys(REPORTS)) {
      const r = await runReport(prisma, w.admin, key, { branchId: w.branch.id });
      expect(r.columns.length, key).toBeGreaterThan(2);
    }
    const branches = await runReport(prisma, w.admin, "branches", { branchId: w.branch.id });
    expect(branches.rows[0]).toMatchObject({ units: 1, occupied: 1, unitsPct: 100, active: 1, value: "13800.00", collected: "1150.00", overdue: "1150.00" });
    const coll = await runReport(prisma, w.admin, "collections", { branchId: w.branch.id });
    expect(coll.totals?.amount).toBe("1150.00");
    const overdue = await runReport(prisma, w.admin, "overdue", { branchId: w.branch.id });
    expect(overdue.rows[0]?.overdue).toBe("1150.00");

    const bmOther = (await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] })).actor;
    await expect(runReport(prisma, bmOther, "contracts", { branchId: w.branch.id })).rejects.toThrow(/الفرع/);
    const scoped = await runReport(prisma, bmOther, "contracts", {});
    expect(scoped.rows.some((r) => r.no === c.contractNo)).toBe(false);
  });

  it("الصلاحيات: المبيعات بلا تقارير، والاطلاع فقط بلا تصدير، ونشاط الموظفين لمن يملك التدقيق", async () => {
    const w = await world();
    const sales = await w.actorIn("SALES_EMPLOYEE");
    const ro = await w.actorIn("READ_ONLY");
    const bm = await w.actorIn("BRANCH_MANAGER");
    await expect(runReport(prisma, sales, "contracts", {})).rejects.toThrow(/صلاحية/);
    await expect(runReport(prisma, ro, "contracts", {})).resolves.toBeTruthy();
    await expect(runReport(prisma, ro, "contracts", {}, { forExport: true })).rejects.toThrow(/صلاحية/);
    expect(canViewReport(bm, "activity")).toBe(false);
    await expect(runReport(prisma, bm, "activity", {})).rejects.toThrow(/صلاحية/);
    expect(canViewReport(w.admin, "activity")).toBe(true);
  });

  it("تقرير المستأجرين لا يحتوي رقم الهوية حتى لمن يملك صلاحيته", async () => {
    const w = await world();
    await prisma.tenant.update({ where: { id: w.tenant.id }, data: { nationalId: "1999999999" } });
    const r = await runReport(prisma, w.admin, "tenants", { branchId: w.branch.id });
    expect(JSON.stringify(r.rows)).not.toContain("1999999999");
  });

  it("ملف Excel عربي من اليمين لليسار بأرقام وتواريخ حقيقية ونص آمن من الصيغ", async () => {
    const buf = await buildWorkbook({
      title: "تقرير التحصيل",
      subtitle: "الفرع: الازدهار",
      generatedBy: "مسؤول النظام",
      columns: [
        { key: "tenant", header: "المستأجر", type: "text" },
        { key: "date", header: "التاريخ", type: "date" },
        { key: "amount", header: "المبلغ", type: "money" },
        { key: "pct", header: "النسبة", type: "percent" },
      ],
      rows: [
        { tenant: "شركة الريادة للتقنية", date: new Date("2026-11-10T00:00:00Z"), amount: "1150.50", pct: 25 },
        { tenant: "=HYPERLINK(\"http://evil\")", date: new Date("2026-11-11T00:00:00Z"), amount: "100", pct: 50 },
      ],
      totals: { tenant: "الإجمالي", amount: "1250.50" },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]?.rightToLeft).toBe(true);
    expect(String(ws.getCell(1, 1).value)).toContain("شركة ذكي");
    expect(ws.getCell(4, 1).value).toBe("المستأجر");
    expect(ws.getCell(5, 1).text).toBe("شركة الريادة للتقنية");
    expect(ws.getCell(5, 3).value).toBe(1150.5);
    expect(ws.getCell(5, 3).numFmt).toBe("#,##0.00");
    expect(ws.getCell(5, 2).value).toBeInstanceOf(Date);
    expect(ws.getCell(5, 4).value).toBe(0.25);
    expect(ws.getCell(6, 1).formula).toBeUndefined();
    expect(ws.getCell(6, 1).text).toContain("HYPERLINK");
    expect(ws.getCell(7, 3).value).toBe(1250.5);
  });
});

describe("بيانات الرسوم البيانية", () => {
  it("الإشغال حسب الفرع، تطور الإشغال، العقود الجديدة والمنتهية، والمستحق مقابل المحصّل", async () => {
    const w = await world();
    const c = await w.draft(`${TODAY.slice(0, 7)}-01`);
    await submitForApproval(prisma, w.admin, c.id);
    await approveContract(prisma, w.admin, c.id);
    const d = await getDashboardCharts(prisma, w.admin, { branchId: w.branch.id, months: 6 });
    expect(d.months).toHaveLength(6);
    expect(d.months.at(-1)).toBe(TODAY.slice(0, 7));
    expect(d.occupancyByBranch).toEqual([{ name: w.branch.nameAr, unitsPct: 100, seatsPct: 100, units: 1 }]);
    expect(d.occupancyTrend.at(-1)?.unitsPct).toBe(100);
    expect(d.occupancyTrend.at(-2)?.unitsPct).toBe(0);
    expect(d.contractsFlow.at(-1)).toEqual({ month: TODAY.slice(0, 7), started: 1, ended: 0 });
    expect(d.money?.at(-1)).toEqual({ month: TODAY.slice(0, 7), billed: 1150, collected: 0 });
    const ro = await w.actorIn("SALES_EMPLOYEE");
    expect((await getDashboardCharts(prisma, ro, {})).money).toBeNull();
  });
});
