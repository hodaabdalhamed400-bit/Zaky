import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma, makeActor } from "./helpers";
import { autoLayout, defaultSize, getBranchScene, resetBranchLayout, saveBranchLayout } from "@/services/branch-scene.service";
import { createUnit } from "@/services/units.service";

async function setup() {
  const code = `L${randomUUID().slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "Y")}`;
  const branch = await prisma.branch.create({ data: { code, nameAr: `فرع مخطط ${randomUUID().slice(0, 6)}` } });
  const { actor: admin } = await makeActor("SUPER_ADMIN");
  const type = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } });
  const room = await prisma.unitType.findUniqueOrThrow({ where: { key: "MEETING_ROOM" } });
  const a = await createUnit(prisma, admin, { branchId: branch.id, unitTypeId: type.id, code: "101", capacity: "2", basePrice: "2000", pricingCycle: "MONTH", status: "AVAILABLE", areaSqm: "20" });
  const b = await createUnit(prisma, admin, { branchId: branch.id, unitTypeId: type.id, code: "102", capacity: "4", basePrice: "3000", pricingCycle: "MONTH", status: "MAINTENANCE" });
  const c = await createUnit(prisma, admin, { branchId: branch.id, unitTypeId: room.id, code: "قاعة", capacity: "8", basePrice: "100", pricingCycle: "HOUR", status: "AVAILABLE" });
  return { branch, admin, units: [a, b, c] };
}

describe("مجسم الفرع ثلاثي الأبعاد ومخططه", () => {
  it("المقاس الافتراضي من المساحة أو النوع", () => {
    const s = defaultSize({ typeKey: "PRIVATE_OFFICE", capacity: 2, areaSqm: 20 });
    expect(s.w * s.d).toBeGreaterThan(16);
    expect(s.w * s.d).toBeLessThan(25);
    expect(defaultSize({ typeKey: "MEETING_ROOM", capacity: 12, areaSqm: null })).toEqual({ w: 8, d: 4.5 });
  });

  it("الترتيب التلقائي لا يُنتج تداخلًا ولا يحرك الوحدات الموضوعة", () => {
    const units = [
      { id: "p", x: 3, y: 2, w: 6, d: 5, placed: true },
      ...Array.from({ length: 14 }, (_, i) => ({ id: `u${i}`, x: 0, y: 0, w: 3 + (i % 4), d: 3 + (i % 3), placed: false })),
    ];
    const out = autoLayout(units);
    expect(out[0]).toEqual(units[0]);
    for (const a of out)
      for (const b of out)
        if (a !== b) expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d).toBe(false);
  });

  it("المشهد يعرض كل الوحدات بحالاتها ويرتب غير الموضوعة تلقائيًا", async () => {
    const { branch, admin } = await setup();
    const s = await getBranchScene(prisma, admin, branch.id);
    expect(s.total).toBe(3);
    expect(s.placedCount).toBe(0);
    const units = s.floors.flatMap((f) => f.units);
    expect(units.find((u) => u.code === "101")!.tone).toBe("available");
    expect(units.find((u) => u.code === "102")!.tone).toBe("maintenance");
    expect(units.find((u) => u.code === "قاعة")!.typeKey).toBe("MEETING_ROOM");
  });

  it("حفظ المخطط ثم إعادته للتلقائي، مع منع وحدات فرع آخر وقيم خارج الحدود", async () => {
    const { branch, admin, units } = await setup();
    const other = await setup();
    await saveBranchLayout(prisma, admin, branch.id, [{ unitId: units[0]!.id, x: 2.5, y: 1, w: 5, d: 4 }]);
    let s = await getBranchScene(prisma, admin, branch.id);
    const u = s.floors.flatMap((f) => f.units).find((x) => x.code === "101")!;
    expect(u).toMatchObject({ placed: true, x: 2.5, y: 1, w: 5, d: 4 });
    expect(s.placedCount).toBe(1);
    await expect(saveBranchLayout(prisma, admin, branch.id, [{ unitId: other.units[0]!.id, x: 0, y: 0, w: 3, d: 3 }])).rejects.toThrow(/لا تتبع/);
    await expect(saveBranchLayout(prisma, admin, branch.id, [{ unitId: units[0]!.id, x: 0, y: 0, w: 0.2, d: 3 }])).rejects.toThrow();
    await expect(prisma.$executeRaw`UPDATE units SET layout_x = 1 WHERE id = ${units[1]!.id}::uuid`).rejects.toThrow(/units_layout_complete/);
    await resetBranchLayout(prisma, admin, branch.id);
    s = await getBranchScene(prisma, admin, branch.id);
    expect(s.placedCount).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: { in: ["unit.layout_update", "unit.layout_reset"] }, entityId: branch.id } })).toBe(2);
  });

  it("المخطط الجاهز لفرع السويدي: الوحدة المسجلة تأخذ مكانها، والغرف غير المسجلة والمرافق تظهر", async () => {
    const { admin } = await setup();
    const swd = await prisma.branch.findUniqueOrThrow({ where: { code: "SWD" } });
    const type = await prisma.unitType.findUniqueOrThrow({ where: { key: "PRIVATE_OFFICE" } });
    const code = "113";
    await prisma.unit.deleteMany({ where: { branchId: swd.id, code } });
    await createUnit(prisma, admin, { branchId: swd.id, unitTypeId: type.id, code, capacity: "1", basePrice: "1500", pricingCycle: "MONTH", status: "AVAILABLE" });
    const s = await getBranchScene(prisma, admin, swd.id);
    const all = s.floors.flatMap((f) => f.units);
    const { BRANCH_PLANS } = await import("@/lib/branch-plans");
    const planRoom = BRANCH_PLANS.SWD!.find((p) => p.code === code)!;
    const u = all.find((x) => x.code === code && x.kind === "unit")!;
    expect(s.hasPlan).toBe(true);
    expect(u).toMatchObject({ placed: true, saved: false, x: planRoom.x, y: planRoom.y });
    expect(all.some((x) => x.kind === "plan" && x.code === code)).toBe(false);
    expect(all.some((x) => x.kind === "facility")).toBe(true);
    expect(s.unregisteredCodes.length).toBe(BRANCH_PLANS.SWD!.filter((p) => p.type !== "FACILITY").length - s.planUnits);
    await prisma.unit.deleteMany({ where: { branchId: swd.id, code } });
  });

  it("مخطط متعدد الأدوار (الروضة): كل غرفة في دورها، ويُطابَق الدور المسجل بالاسم", async () => {
    const { admin } = await setup();
    const rwd = await prisma.branch.findUniqueOrThrow({ where: { code: "RWD" } });
    const { BRANCH_PLANS } = await import("@/lib/branch-plans");
    const plan = BRANCH_PLANS.RWD!;
    let s = await getBranchScene(prisma, admin, rwd.id);
    const names = s.floors.map((f) => f.name);
    for (const n of ["الأرضي", "الأول", "الثاني", "الثالث"]) expect(names.some((x) => x.includes(n.slice(2)))).toBe(true);
    const second = s.floors.find((f) => f.name.includes("ثاني"))!;
    expect(second.units.filter((u) => u.kind === "plan").length).toBe(plan.filter((p) => p.floor === "الثاني" && p.type !== "FACILITY" && !s.floors.some((f) => f.units.some((u) => u.kind === "unit" && u.code === p.code))).length);
    // دور مسجل باسم مختلف الكتابة («الدور الأول») يأخذ غرف «الأول»
    const created = await prisma.floor.upsert({ where: { branchId_name: { branchId: rwd.id, name: "الدور الأول" } }, create: { branchId: rwd.id, name: "الدور الأول", level: 1 }, update: {} });
    s = await getBranchScene(prisma, admin, rwd.id);
    const first = s.floors.find((f) => f.id === created.id)!;
    expect(first.units.some((u) => u.code === "101")).toBe(true);
    expect(s.floors.filter((f) => f.name.includes("اول") || f.name.includes("أول")).length).toBe(1);
    await prisma.floor.delete({ where: { id: created.id } }).catch(() => {});
  });

  it("مخطط غرناطة جاهز وبلا تداخل", async () => {
    const { BRANCH_PLANS } = await import("@/lib/branch-plans");
    const p = BRANCH_PLANS.GRN!;
    expect(p.filter((r) => r.type === "PRIVATE_OFFICE")).toHaveLength(46);
    for (const a of p)
      for (const b of p)
        if (a !== b) expect(a.x < b.x + b.w - 0.05 && b.x < a.x + a.w - 0.05 && a.y < b.y + b.d - 0.05 && b.y < a.y + a.d - 0.05).toBe(false);
  });

  it("الصلاحيات: العرض لمن يرى الفرع، والتعديل لمن يدير الوحدات", async () => {
    const { branch, units } = await setup();
    const { actor: viewer } = await makeActor("READ_ONLY", { branchCodes: [branch.code] });
    const { actor: stranger } = await makeActor("BRANCH_MANAGER", { branchCodes: ["IZD"] });
    await expect(getBranchScene(prisma, viewer, branch.id)).resolves.toBeTruthy();
    await expect(saveBranchLayout(prisma, viewer, branch.id, [{ unitId: units[0]!.id, x: 0, y: 0, w: 3, d: 3 }])).rejects.toThrow();
    await expect(getBranchScene(prisma, stranger, branch.id)).rejects.toThrow();
  });
});
