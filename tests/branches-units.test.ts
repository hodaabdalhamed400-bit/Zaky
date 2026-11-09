import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor, makeTenant, makeContract, linkUnit, branchByCode } from "./helpers";
import { createBranch, createFloor, deleteFloor, getBranch, listBranches, updateBranch } from "@/services/branches.service";
import {
  createUnit, createUnitType, effectiveUnitStatus, listUnits, setUnitArchived, setUnitTypeActive, updateUnit,
} from "@/services/units.service";
import { computeOccupancy } from "@/services/occupancy.service";
import { addDays, todayInRiyadh } from "@/lib/dates";

const rnd = () => randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "X");
const newCode = () => `Z${rnd()}`;

async function freshBranch(status: "ACTIVE" | "PREPARING" | "INACTIVE" = "ACTIVE") {
  return prisma.branch.create({ data: { code: newCode(), nameAr: `فرع ${randomUUID().slice(0, 6)}`, status } });
}
async function typeId(key: string) {
  return (await prisma.unitType.findUniqueOrThrow({ where: { key } })).id;
}
async function unitInput(branchId: string, over: Record<string, unknown> = {}) {
  return {
    branchId,
    unitTypeId: await typeId("PRIVATE_OFFICE"),
    code: `U-${randomUUID().slice(0, 6)}`,
    areaSqm: "20.5",
    capacity: "2",
    basePrice: "2,300.00",
    pricingCycle: "MONTH",
    status: "AVAILABLE",
    ...over,
  };
}

describe("إدارة الفروع", () => {
  it("مسؤول النظام ينشئ فرعًا ويُسجَّل في التدقيق، ومدير الفرع لا يستطيع", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const code = newCode();
    const b = await createBranch(prisma, actor, { code: code.toLowerCase(), nameAr: `فرع جديد ${code}`, city: "الرياض", status: "PREPARING", phone: "0500510051" });
    expect(b.code).toBe(code);
    expect(await prisma.auditLog.count({ where: { action: "branch.create", entityId: b.id } })).toBe(1);
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    await expect(createBranch(prisma, bm, { code: newCode(), nameAr: "ممنوع", status: "ACTIVE" })).rejects.toThrow(/صلاحية/);
  });

  it("يرفض الرمز والاسم المكررين ورابط الخريطة غير الآمن", async () => {
    const { actor } = await makeActor("GENERAL_MANAGER");
    await expect(createBranch(prisma, actor, { code: "IZD", nameAr: "اسم مختلف", status: "ACTIVE" })).rejects.toThrow(/رمز الفرع مستخدم/);
    await expect(createBranch(prisma, actor, { code: newCode(), nameAr: "الازدهار", status: "ACTIVE" })).rejects.toThrow(/بنفس الاسم/);
    await expect(createBranch(prisma, actor, { code: newCode(), nameAr: "خريطة", status: "ACTIVE", mapUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await expect(createBranch(prisma, actor, { code: "1AB", nameAr: "رمز سيء", status: "ACTIVE" })).rejects.toThrow(/رمز الفرع/);
  });

  it("لا يُوقَف فرع عليه عقد نشط، ويُوقَف بدون حذف بياناته", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const b = await freshBranch();
    const t = await makeTenant();
    const c = await makeContract({ branchId: b.id, tenantId: t.id, start: "2026-01-01", end: "2026-12-31" });
    const base = { code: b.code, nameAr: b.nameAr };
    await expect(updateBranch(prisma, actor, b.id, { ...base, status: "INACTIVE" })).rejects.toThrow(/عقد نشط/);
    await expect(updateBranch(prisma, actor, b.id, { ...base, code: newCode(), status: "ACTIVE" })).rejects.toThrow(/رمز فرع له عقود/);
    await prisma.contract.update({ where: { id: c.id }, data: { status: "EXPIRED" } });
    const off = await updateBranch(prisma, actor, b.id, { ...base, status: "INACTIVE" });
    expect(off.status).toBe("INACTIVE");
    expect(off.archivedAt).not.toBeNull();
    expect(await prisma.contract.count({ where: { branchId: b.id } })).toBe(1);
    const log = await prisma.auditLog.findFirst({ where: { action: "branch.status_change", entityId: b.id } });
    expect(log?.before).toMatchObject({ status: "ACTIVE" });
    expect(log?.after).toMatchObject({ status: "INACTIVE" });
  });

  it("مدير الفرع يرى فرعه فقط ولا يفتح فرعًا آخر", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["NFL"] });
    const { branches } = await listBranches(prisma, actor);
    expect(branches.map((b) => b.code)).toEqual(["NFL"]);
    const other = await branchByCode("TBK");
    await expect(getBranch(prisma, actor, other.id)).rejects.toThrow(/الفرع/);
  });

  it("الأدوار: إضافة، منع التكرار، ومنع حذف دور مستخدم", async () => {
    const { actor } = await makeActor("OPERATIONS_EMPLOYEE", { branchCodes: ["NFL"] });
    const nfl = await branchByCode("NFL");
    const f = await createFloor(prisma, actor, nfl.id, { name: `الأرضي ${rnd()}`, level: "0" });
    await expect(createFloor(prisma, actor, nfl.id, { name: f.name, level: "1" })).rejects.toThrow(/بنفس الاسم/);
    await createUnit(prisma, actor, await unitInput(nfl.id, { floorId: f.id }));
    await expect(deleteFloor(prisma, actor, f.id)).rejects.toThrow(/مرتبط بوحدات/);
    const empty = await createFloor(prisma, actor, nfl.id, { name: `فارغ ${rnd()}`, level: "2" });
    await deleteFloor(prisma, actor, empty.id);
    const tbk = await branchByCode("TBK");
    await expect(createFloor(prisma, actor, tbk.id, { name: "x", level: "0" })).rejects.toThrow(/الفرع/);
  });
});

describe("إدارة الوحدات", () => {
  it("ينشئ وحدة ويحول الأرقام العربية والفواصل بدقة ويأخذ طريقة الإشغال من النوع", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const izd = await branchByCode("IZD");
    const u = await createUnit(prisma, actor, await unitInput(izd.id, { areaSqm: "١٢.٥", basePrice: "1,500.50" }));
    expect(u.basePrice.toFixed(2)).toBe("1500.50");
    expect(u.areaSqm?.toFixed(2)).toBe("12.50");
    expect(u.occupancyMode).toBe("EXCLUSIVE");
    const shared = await createUnit(prisma, actor, await unitInput(izd.id, { unitTypeId: await typeId("SHARED_OFFICE"), capacity: "12" }));
    expect(shared.occupancyMode).toBe("SHARED");
  });

  it("رقم الوحدة فريد داخل الفرع فقط", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const a = await freshBranch();
    const b = await freshBranch();
    await createUnit(prisma, actor, await unitInput(a.id, { code: "101" }));
    await expect(createUnit(prisma, actor, await unitInput(a.id, { code: "101" }))).rejects.toThrow(/مستخدم في هذا الفرع/);
    await expect(createUnit(prisma, actor, await unitInput(b.id, { code: "101" }))).resolves.toBeTruthy();
  });

  it("يرفض المدخلات غير الصحيحة", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const b = await freshBranch();
    const other = await freshBranch();
    const floorOther = await prisma.floor.create({ data: { branchId: other.id, name: "الأول" } });
    await expect(createUnit(prisma, actor, await unitInput(b.id, { status: "RENTED" }))).rejects.toThrow(/مؤجرة تُحدد تلقائيًا/);
    await expect(createUnit(prisma, actor, await unitInput(b.id, { basePrice: "abc" }))).rejects.toThrow(/السعر/);
    await expect(createUnit(prisma, actor, await unitInput(b.id, { basePrice: "10.555" }))).rejects.toThrow(/منزلتين/);
    await expect(createUnit(prisma, actor, await unitInput(b.id, { capacity: "0" }))).rejects.toThrow(/السعة/);
    await expect(createUnit(prisma, actor, await unitInput(b.id, { floorId: floorOther.id }))).rejects.toThrow(/لا يتبع/);
    const inactive = await freshBranch("INACTIVE");
    await expect(createUnit(prisma, actor, await unitInput(inactive.id))).rejects.toThrow(/موقوف/);
  });

  it("الصلاحيات: موظف المبيعات لا يضيف وحدات، ومدير الفرع لا يضيف في فرع آخر", async () => {
    const { actor: sales } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["IZD"] });
    const izd = await branchByCode("IZD");
    await expect(createUnit(prisma, sales, await unitInput(izd.id))).rejects.toThrow(/صلاحية/);
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    const tbk = await branchByCode("TBK");
    await expect(createUnit(prisma, bm, await unitInput(tbk.id))).rejects.toThrow(/الفرع/);
    await expect(listUnits(prisma, bm, { branchId: tbk.id })).rejects.toThrow(/الفرع/);
  });

  it("لا يمكن أرشفة أو إيقاف وحدة عليها عقد ساري أو قادم، وتُستعاد الأرشفة", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const b = await freshBranch();
    const input = await unitInput(b.id);
    const u = await createUnit(prisma, actor, input);
    const t = await makeTenant();
    const today = todayInRiyadh();
    const c = await makeContract({ branchId: b.id, tenantId: t.id, start: addDays(today, 10), end: addDays(today, 100), status: "PENDING_APPROVAL" });
    await linkUnit(c.id, u, addDays(today, 10), addDays(today, 100));
    await expect(setUnitArchived(prisma, actor, u.id, true)).rejects.toThrow(/عقد ساري أو قادم/);
    await expect(updateUnit(prisma, actor, u.id, { ...input, status: "INACTIVE" })).rejects.toThrow(/عقد ساري أو قادم/);
    await expect(updateUnit(prisma, actor, u.id, { ...input, branchId: (await freshBranch()).id })).rejects.toThrow(/نقل وحدة/);
    await prisma.contract.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
    const archived = await setUnitArchived(prisma, actor, u.id, true);
    expect(archived.archivedAt).not.toBeNull();
    await expect(updateUnit(prisma, actor, u.id, input)).rejects.toThrow(/مؤرشفة/);
    const restored = await setUnitArchived(prisma, actor, u.id, false);
    expect(restored.archivedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: u.id, action: { in: ["unit.archive", "unit.restore"] } } })).toBe(2);
  });

  it("الفلاتر: الحالة المشتقة من العقود والسعر والبحث", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const b = await freshBranch();
    const today = todayInRiyadh();
    const rented = await createUnit(prisma, actor, await unitInput(b.id, { code: "A-1", basePrice: "1000" }));
    await createUnit(prisma, actor, await unitInput(b.id, { code: "A-2", basePrice: "3000" }));
    await createUnit(prisma, actor, await unitInput(b.id, { code: "B-1", basePrice: "5000", status: "MAINTENANCE" }));
    const t = await makeTenant();
    const c = await makeContract({ branchId: b.id, tenantId: t.id, start: addDays(today, -5), end: addDays(today, 300) });
    await linkUnit(c.id, rented, addDays(today, -5), addDays(today, 300));

    const codes = async (f: Record<string, string>) => (await listUnits(prisma, actor, { branchId: b.id, ...f })).units.map((u) => u.code).sort();
    expect(await codes({})).toEqual(["A-1", "A-2", "B-1"]);
    expect(await codes({ status: "OCCUPIED" })).toEqual(["A-1"]);
    expect(await codes({ status: "FREE" })).toEqual(["A-2"]);
    expect(await codes({ status: "MAINTENANCE" })).toEqual(["B-1"]);
    expect(await codes({ minPrice: "2000", maxPrice: "4000" })).toEqual(["A-2"]);
    expect(await codes({ q: "a-" })).toEqual(["A-1", "A-2"]);
    // فلاتر غير صالحة تُتجاهل بأمان بدل أن تكسر الصفحة
    expect(await codes({ status: "HACK", minPrice: "1; DROP TABLE units" })).toHaveLength(3);
    const res = await listUnits(prisma, actor, { branchId: b.id, status: "OCCUPIED" });
    expect(res.units[0]!.occupiedSeats).toBe(1);
  });

  it("الحالة المعروضة للوحدة المشتركة المؤجرة جزئيًا", () => {
    const base = { status: "AVAILABLE" as const, archivedAt: null };
    expect(effectiveUnitStatus({ ...base, occupancyMode: "SHARED", capacity: 10 }, 4).label).toBe("مؤجرة جزئيًا 4/10");
    expect(effectiveUnitStatus({ ...base, occupancyMode: "SHARED", capacity: 10 }, 10).label).toBe("مؤجرة");
    expect(effectiveUnitStatus({ ...base, occupancyMode: "EXCLUSIVE", capacity: 1 }, 0).label).toBe("متاحة");
  });

  it("الأنواع المخصصة: إنشاء وتعطيل يمنع استخدامها في وحدات جديدة", async () => {
    const { actor } = await makeActor("GENERAL_MANAGER");
    const t = await createUnitType(prisma, actor, { nameAr: `استوديو ${rnd()}`, occupancyMode: "EXCLUSIVE" });
    await expect(createUnitType(prisma, actor, { nameAr: t.nameAr, occupancyMode: "SHARED" })).rejects.toThrow(/بنفس الاسم/);
    await setUnitTypeActive(prisma, actor, t.id, false);
    const b = await freshBranch();
    await expect(createUnit(prisma, actor, await unitInput(b.id, { unitTypeId: t.id }))).rejects.toThrow(/غير متاح/);
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    await expect(createUnitType(prisma, bm, { nameAr: "x y", occupancyMode: "SHARED" })).rejects.toThrow(/صلاحية/);
  });
});

describe("قرارات معتمدة: الفروع والحجوزات والعقود", () => {
  it("بيانات الفروع والإعدادات وطريقة تأجير قاعات الاجتماعات", async () => {
    expect(await branchByCode("MRK")).toMatchObject({ city: "الرياض" });
    expect((await branchByCode("SWD")).notes).toContain("القصر مول");
    expect((await branchByCode("IMU")).notes).toContain("بهو الجامعة");
    expect(await prisma.unitType.findUniqueOrThrow({ where: { key: "MEETING_ROOM" } })).toMatchObject({ leaseMode: "BOOKING" });
    expect(await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } })).toMatchObject({ leaseMode: "LEASE" });
    const s = Object.fromEntries((await prisma.systemSetting.findMany()).map((x) => [x.key, x.value]));
    expect(s["contract.number_format"]).toBe("ZK-{BRANCH}-{YEAR}-{SEQ4}");
    expect(s["contract.deposits_enabled"]).toBe(false);
    expect(s["contract.early_exit_refund"]).toBe(false);
    expect(s["contract.renewal_pricing"]).toBe("NEGOTIATED");
  });

  it("نوع مخصص بالحجوزات", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const t = await createUnitType(prisma, actor, { nameAr: `بودكاست ${rnd()}`, occupancyMode: "EXCLUSIVE", leaseMode: "BOOKING" });
    expect(t.leaseMode).toBe("BOOKING");
  });
});

describe("حساب الإشغال (وحدات / مقاعد / مساحة)", () => {
  it("يطبق التعريفات المعتمدة بدقة", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const b = await freshBranch();
    const today = todayInRiyadh();
    const mk = (over: Record<string, unknown>) => unitInput(b.id, over).then((i) => createUnit(prisma, actor, i));
    const office1 = await mk({ code: "O1", areaSqm: "20", capacity: "2" }); // حصرية مؤجرة
    await mk({ code: "O2", areaSqm: "30", capacity: "3" }); // حصرية فارغة
    await mk({ code: "O3", areaSqm: "10", capacity: "1", status: "MAINTENANCE" }); // صيانة: ضمن المخزون
    await mk({ code: "O4", areaSqm: "99", capacity: "9", status: "INACTIVE" }); // غير نشطة: خارج المخزون
    const shared = await mk({ code: "S1", unitTypeId: await typeId("SHARED_OFFICE"), areaSqm: "40", capacity: "10" }); // 4 مقاعد مؤجرة
    const archived = await mk({ code: "X1", areaSqm: "50", capacity: "5" });
    await setUnitArchived(prisma, actor, archived.id, true);
    const future = await mk({ code: "F1", areaSqm: "10", capacity: "1" }); // عقد مستقبلي لا يُحتسب
    await mk({ code: "M1", unitTypeId: await typeId("MEETING_ROOM"), areaSqm: "25", capacity: "8" }); // حجوزات: خارج إشغال العقود

    const t = await makeTenant();
    const active = await makeContract({ branchId: b.id, tenantId: t.id, start: addDays(today, -30), end: addDays(today, 30) });
    await linkUnit(active.id, office1, addDays(today, -30), addDays(today, 30));
    await prisma.contractUnit.create({
      data: { contractId: active.id, unitId: shared.id, branchId: b.id, seats: 4, price: "500", startDate: active.startDate, endDate: active.endDate, blocksOccupancy: true, occupancyMode: "SHARED" },
    });
    const later = await makeContract({ branchId: b.id, tenantId: t.id, start: addDays(today, 5), end: addDays(today, 60) });
    await linkUnit(later.id, future, addDays(today, 5), addDays(today, 60));

    const o = (await computeOccupancy(prisma, [b.id])).get(b.id);
    expect(o.units).toBe(5); // O1 O2 O3 S1 F1
    expect(o.occupiedUnits).toBe(2); // O1 + S1
    expect(o.unitsPct).toBe(40);
    expect(o.seats).toBe(2 + 3 + 1 + 10 + 1);
    expect(o.occupiedSeats).toBe(2 + 4);
    expect(o.seatsPct).toBe(35.3);
    expect(o.area).toBe("110.00"); // 20+30+10+40+10
    expect(o.occupiedArea).toBe("36.00"); // 20 + 40*4/10
    expect(o.areaPct).toBe(32.7);
    expect(o.unitsWithoutArea).toBe(0);

    // مدير فرع آخر لا يرى هذا الفرع في قائمته
    const { actor: bm } = await makeActor("BRANCH_MANAGER", { branchCodes: ["TBK"] });
    const { branches } = await listBranches(prisma, bm);
    expect(branches.some((x) => x.id === b.id)).toBe(false);
  });
});
