import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor } from "./helpers";
import { createSession, validateSession } from "@/lib/auth/session";
import { createUnit } from "@/services/units.service";
import { approveContract, createContract, submitForApproval } from "@/services/contracts.service";
import { bookingDay, cancelBooking, createBooking, freeHoursLeft, getBooking } from "@/services/bookings.service";
import { approvePayment, getPayment, payerName, recordBookingPayment, reversePayment } from "@/services/payments.service";
import { runReport } from "@/services/reports.service";
import { addDays, addMonthsKeepDay, todayInRiyadh } from "@/lib/dates";

const TODAY = todayInRiyadh();
const DAY = addDays(TODAY, 3); // يوم مستقبلي ثابت للاختبار

async function branch() {
  const code = `B${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "K")}`;
  return prisma.branch.create({ data: { code, nameAr: `فرع حجوزات ${randomUUID().slice(0, 6)}` } });
}

async function world() {
  const { actor: admin } = await makeActor("SUPER_ADMIN");
  const [b1, b2] = [await branch(), await branch()];
  const room = (b: { id: string }, code: string, price = "100") =>
    prisma.unitType.findUniqueOrThrow({ where: { key: "MEETING_ROOM" } }).then((t) =>
      createUnit(prisma, admin, { branchId: b.id, unitTypeId: t.id, code, capacity: "8", basePrice: price, pricingCycle: "HOUR", status: "AVAILABLE" }),
    );
  const office = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } }).then((t) =>
    createUnit(prisma, admin, { branchId: b1.id, unitTypeId: t.id, code: "O1", capacity: "1", basePrice: "2000", pricingCycle: "MONTH", status: "AVAILABLE" }),
  );
  const tenant = await prisma.tenant.create({ data: { type: "COMPANY", name: `مستأجر حجز ${randomUUID().slice(0, 5)}`, primaryBranchId: b1.id } });
  const c = await createContract(prisma, admin, { tenantId: tenant.id, branchId: b1.id, startDate: addMonthsKeepDay(TODAY, -1), durationMonths: 12, billingCycle: "MONTHLY", units: [{ unitId: office.id, monthlyPrice: "2000" }] });
  await submitForApproval(prisma, admin, c.id);
  await approveContract(prisma, admin, c.id);
  return { admin, b1, b2, room, tenant };
}

const book = (unitId: string, over: Record<string, unknown>) => ({ unitId, date: DAY, startHour: 10, hours: 1, customerType: "TENANT", ...over });

describe("حجوزات القاعات", () => {
  it("ساعتان مجانيتان يوميًا للمستأجر بعقد نشط، مجموعهما على كل الفروع، والزائد بسعر القاعة", async () => {
    const w = await world();
    const r1 = await w.room(w.b1, "R1", "150");
    const r2 = await w.room(w.b2, "R2", "120");
    expect(await freeHoursLeft(prisma, w.admin, w.tenant.id, DAY)).toEqual({ eligible: true, left: 2 });
    const a = await createBooking(prisma, w.admin, book(r1.id, { tenantId: w.tenant.id, startHour: 9, hours: 1 }));
    expect(a).toMatchObject({ freeHours: 1, paidHours: 0, paymentStatus: "FREE" });
    expect(a.chargeAmount.toFixed(2)).toBe("0.00");
    expect(a.bookingNo).toMatch(/^BK-[A-Z0-9]+-\d{4}-00001$/);
    // فرع آخر: تبقى ساعة مجانية واحدة، والساعتان الأخريان بسعر قاعة الفرع الثاني
    const b = await createBooking(prisma, w.admin, book(r2.id, { tenantId: w.tenant.id, startHour: 13, hours: 3 }));
    expect(b).toMatchObject({ freeHours: 1, paidHours: 2, paymentStatus: "UNPAID" });
    expect(b.chargeAmount.toFixed(2)).toBe("240.00");
    const c = await createBooking(prisma, w.admin, book(r1.id, { tenantId: w.tenant.id, startHour: 18, hours: 1 }));
    expect(c).toMatchObject({ freeHours: 0, paidHours: 1 });
    expect(c.chargeAmount.toFixed(2)).toBe("150.00");
    // يوم آخر: رصيد جديد
    const d = await createBooking(prisma, w.admin, book(r1.id, { tenantId: w.tenant.id, date: addDays(DAY, 1), hours: 2 }));
    expect(d).toMatchObject({ freeHours: 2, paidHours: 0 });
  });

  it("الزائر الخارجي يدفع من أول ساعة، والمستأجر بلا عقد نشط بلا ساعات مجانية", async () => {
    const w = await world();
    const r = await w.room(w.b1, "RV", "100");
    const v = await createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "أحمد زائر", visitorMobile: "0550000000", hours: 2 }));
    expect(v).toMatchObject({ freeHours: 0, paidHours: 2, tenantId: null });
    expect(v.chargeAmount.toFixed(2)).toBe("200.00");
    const prospect = await prisma.tenant.create({ data: { type: "INDIVIDUAL", name: "عميل محتمل", primaryBranchId: w.b1.id } });
    expect((await freeHoursLeft(prisma, w.admin, prospect.id, DAY)).eligible).toBe(false);
    const p = await createBooking(prisma, w.admin, book(r.id, { tenantId: prospect.id, startHour: 14 }));
    expect(p.paidHours).toBe(1);
  });

  it("يمنع التداخل في نفس القاعة (قيد قاعدة البيانات) ويقبل المتتالي", async () => {
    const w = await world();
    const r = await w.room(w.b1, "RX");
    await createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, startHour: 10, hours: 2 }));
    await expect(createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "زائر", startHour: 11 }))).rejects.toThrow(/محجوزة/);
    await expect(createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "زائر", startHour: 12 }))).resolves.toBeTruthy();
    await expect(createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "زائر", startHour: 9 }))).resolves.toBeTruthy();
  });

  it("التزامن: نفس القاعة ونفس الوقت — ينجح حجز واحد؛ ولا تُستهلك الساعات المجانية مرتين", async () => {
    const w = await world();
    const r = await w.room(w.b1, "RC");
    const res = await Promise.allSettled([0, 1, 2, 3].map(() => createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "زائر", startHour: 15 }))));
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rooms = await Promise.all([1, 2, 3].map((i) => w.room(w.b1, `RF${i}`)));
    const done = await Promise.all(rooms.map((x) => createBooking(prisma, w.admin, book(x.id, { tenantId: w.tenant.id, startHour: 16 }))));
    expect(done.reduce((a, b) => a + b.freeHours, 0)).toBe(2);
  });

  it("ساعات العمل والساعات الكاملة وأنواع الوحدات", async () => {
    const w = await world();
    const r = await w.room(w.b1, "RH");
    await expect(createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, startHour: 7 }))).rejects.toThrow(/8 صباحًا/);
    await expect(createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, startHour: 21, hours: 2 }))).rejects.toThrow(/10 مساءً/);
    await expect(createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, hours: 1.5 }))).rejects.toThrow(/الساعة الكاملة/);
    await expect(createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, date: addDays(TODAY, -1) }))).rejects.toThrow(/وقت مضى/);
    const office = await prisma.unit.findFirstOrThrow({ where: { branchId: w.b1.id, code: "O1" } });
    await expect(createBooking(prisma, w.admin, book(office.id, { tenantId: w.tenant.id }))).rejects.toThrow(/لا تُحجز بالساعة/);
  });

  it("الإلغاء يعيد الساعات المجانية، ولا يُلغى حجز عليه دفعة", async () => {
    const w = await world();
    const r = await w.room(w.b1, "RZ", "100");
    const a = await createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, hours: 2 }));
    expect((await freeHoursLeft(prisma, w.admin, w.tenant.id, DAY)).left).toBe(0);
    await cancelBooking(prisma, w.admin, a.id, "العميل اعتذر");
    expect((await freeHoursLeft(prisma, w.admin, w.tenant.id, DAY)).left).toBe(2);
    const paid = await createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "زائر", startHour: 14 }));
    await recordBookingPayment(prisma, w.admin, { bookingId: paid.id, method: "CASH", paidOn: TODAY, idempotencyKey: randomUUID() });
    await expect(cancelBooking(prisma, w.admin, paid.id, "إلغاء")).rejects.toThrow(/دفعة/);
  });

  it("دورة التحصيل: الدفعة بمبلغ الرسوم بالضبط، والاعتماد يصدر إيصالًا ويسدد الحجز، والعكس يعيده", async () => {
    const w = await world();
    const r = await w.room(w.b1, "RP", "100");
    const v = await createBooking(prisma, w.admin, book(r.id, { customerType: "VISITOR", visitorName: "سارة زائرة", hours: 3 }));
    const free = await createBooking(prisma, w.admin, book(r.id, { tenantId: w.tenant.id, startHour: 15 }));
    await expect(recordBookingPayment(prisma, w.admin, { bookingId: free.id, method: "CASH", paidOn: TODAY, idempotencyKey: randomUUID() })).rejects.toThrow(/مجاني/);
    const p = await recordBookingPayment(prisma, w.admin, { bookingId: v.id, method: "CASH", paidOn: TODAY, idempotencyKey: randomUUID() });
    expect(p!.amount.toFixed(2)).toBe("300.00");
    expect(p!.tenantId).toBeNull();
    await expect(recordBookingPayment(prisma, w.admin, { bookingId: v.id, method: "CASH", paidOn: TODAY, idempotencyKey: randomUUID() })).rejects.toThrow(/بانتظار المراجعة/);
    const a = await approvePayment(prisma, w.admin, p!.id);
    expect(a!.receiptNo).toMatch(/^RC-/);
    expect((await getBooking(prisma, w.admin, v.id)).booking.paymentStatus).toBe("PAID");
    expect(payerName((await getPayment(prisma, w.admin, p!.id)).payment)).toBe("سارة زائرة (زائر)");
    const report = await runReport(prisma, w.admin, "collections", { branchId: w.b1.id });
    expect(report.rows.some((x) => x.tenant === "سارة زائرة (زائر)" && x.amount === "300.00")).toBe(true);
    await reversePayment(prisma, w.admin, p!.id, "خطأ في الإدخال");
    expect((await getBooking(prisma, w.admin, v.id)).booking.paymentStatus).toBe("UNPAID");
  });

  it("الصلاحيات: موظف الفرع يحجز في فرعه فقط، والمحاسب يرى ولا يحجز", async () => {
    const w = await world();
    const r1 = await w.room(w.b1, "RA");
    const r2 = await w.room(w.b2, "RB");
    const mk = async (role: "SALES_EMPLOYEE" | "ACCOUNTANT", branchId: string) => {
      const { user } = await makeActor(role);
      await prisma.userBranchAccess.create({ data: { userId: user.id, branchId } });
      return (await validateSession(prisma, (await createSession(prisma, user.id)).token))!;
    };
    const sales = await mk("SALES_EMPLOYEE", w.b1.id);
    await expect(createBooking(prisma, sales, book(r1.id, { tenantId: w.tenant.id }))).resolves.toBeTruthy();
    await expect(createBooking(prisma, sales, book(r2.id, { customerType: "VISITOR", visitorName: "زائر" }))).rejects.toThrow(/الفرع/);
    const acc = await mk("ACCOUNTANT", w.b1.id);
    expect((await bookingDay(prisma, acc, { branchId: w.b1.id, date: DAY })).bookings).toHaveLength(1);
    await expect(createBooking(prisma, acc, book(r1.id, { customerType: "VISITOR", visitorName: "زائر", startHour: 14 }))).rejects.toThrow(/صلاحية/);
  });
});
