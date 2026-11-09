import { describe, expect, it } from "vitest";
import { prisma, makeActor, makeUser, STRONG, uniqueEmail, branchByCode } from "./helpers";
import { createUser, listUsers, resetUserPassword, updateUser } from "@/services/users.service";
import { getDashboardStats } from "@/services/dashboard.service";
import { assertBranchAccess, branchWhere, can } from "@/lib/rbac/guard";
import { validateSession, createSession } from "@/lib/auth/session";

async function roleId(key: string) {
  return (await prisma.role.findUniqueOrThrow({ where: { key } })).id;
}

describe("الصلاحيات حسب الدور", () => {
  it("الصلاحيات تُحمَّل من قاعدة البيانات لكل دور", async () => {
    const { actor: ro } = await makeActor("READ_ONLY", { branchCodes: ["GRN"] });
    const { actor: acc } = await makeActor("ACCOUNTANT", { branchCodes: ["GRN"] });
    expect(can(ro, "dashboard.view")).toBe(true);
    expect(can(ro, "users.manage")).toBe(false);
    expect(can(ro, "tenants.view_sensitive")).toBe(false);
    expect(can(acc, "payments.approve")).toBe(true);
    expect(can(acc, "users.view")).toBe(false);
  });

  it("مدير الفرع لا يصل إلى فرع آخر", async () => {
    const { actor } = await makeActor("BRANCH_MANAGER", { branchCodes: ["GRN"] });
    const grn = await branchByCode("GRN");
    const tbk = await branchByCode("TBK");
    expect(() => assertBranchAccess(actor, grn.id)).not.toThrow();
    expect(() => assertBranchAccess(actor, tbk.id)).toThrow(/الفرع/);
    await expect(getDashboardStats(prisma, actor, { branchId: tbk.id })).rejects.toThrow(/الفرع/);
    const visible = await prisma.branch.findMany({ where: branchWhere(actor, "id") });
    expect(visible.map((b) => b.code)).toEqual(["GRN"]);
  });

  it("مستخدم بلا صلاحية users.view لا يستطيع عرض المستخدمين", async () => {
    const { actor } = await makeActor("SALES_EMPLOYEE", { branchCodes: ["GRN"] });
    await expect(listUsers(prisma, actor)).rejects.toThrow(/صلاحية/);
  });
});

describe("إدارة المستخدمين", () => {
  it("مسؤول النظام ينشئ مستخدمًا بكلمة مرور مؤقتة ويُسجَّل في التدقيق", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const grn = await branchByCode("GRN");
    const email = uniqueEmail("new");
    const u = await createUser(prisma, actor, { email, name: "موظف جديد", roleId: await roleId("SALES_EMPLOYEE"), branchIds: [grn.id], password: STRONG });
    expect(u.mustChangePassword).toBe(true);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(stored.passwordHash).not.toContain(STRONG);
    const log = await prisma.auditLog.findFirst({ where: { action: "user.create", entityId: u.id } });
    expect(log?.userId).toBe(actor.id);
    expect(JSON.stringify(log?.after)).not.toContain("argon2");
  });

  it("يرفض البريد المكرر وكلمة المرور الضعيفة والدور المقيد بدون فرع", async () => {
    const { actor } = await makeActor("SUPER_ADMIN");
    const existing = await makeUser("READ_ONLY", { branchCodes: ["GRN"] });
    const grn = await branchByCode("GRN");
    const sales = await roleId("SALES_EMPLOYEE");
    await expect(createUser(prisma, actor, { email: existing.email, name: "مكرر", roleId: sales, branchIds: [grn.id], password: STRONG })).rejects.toThrow(/يوجد مستخدم/);
    await expect(createUser(prisma, actor, { email: uniqueEmail(), name: "ضعيف", roleId: sales, branchIds: [grn.id], password: "abc" })).rejects.toThrow();
    await expect(createUser(prisma, actor, { email: uniqueEmail(), name: "بلا فرع", roleId: sales, branchIds: [], password: STRONG })).rejects.toThrow(/فرع/);
  });

  it("الإدارة العليا لا تستطيع منح دور مسؤول النظام أو تعديل حسابه (منع التصعيد)", async () => {
    const { actor: gm } = await makeActor("GENERAL_MANAGER");
    const sa = await makeUser("SUPER_ADMIN");
    await expect(
      createUser(prisma, gm, { email: uniqueEmail(), name: "تصعيد", roleId: await roleId("SUPER_ADMIN"), branchIds: [], password: STRONG }),
    ).rejects.toThrow(/مسؤول النظام/);
    await expect(
      updateUser(prisma, gm, sa.id, { name: "x y", roleId: sa.roleId, branchIds: [], isActive: false }),
    ).rejects.toThrow(/مسؤول النظام/);
    await expect(resetUserPassword(prisma, gm, sa.id, "Another-Pass-123")).rejects.toThrow(/مسؤول النظام/);
  });

  it("لا يستطيع المستخدم تعطيل نفسه أو تغيير دوره", async () => {
    const { actor, user } = await makeActor("SUPER_ADMIN");
    await expect(updateUser(prisma, actor, user.id, { name: user.name, roleId: user.roleId, branchIds: [], isActive: false })).rejects.toThrow(/تعطيل/);
    await expect(updateUser(prisma, actor, user.id, { name: user.name, roleId: await roleId("READ_ONLY"), branchIds: [], isActive: true })).rejects.toThrow(/دورك/);
  });

  it("يبقى مسؤول نظام نشط واحد على الأقل", async () => {
    // تعطيل جميع مسؤولي النظام الآخرين عدا اثنين
    const { actor: a } = await makeActor("SUPER_ADMIN");
    await prisma.user.updateMany({ where: { role: { key: "SUPER_ADMIN" }, id: { not: a.id } }, data: { isActive: false } });
    const b = await makeUser("SUPER_ADMIN");
    // تعطيل b مسموح لأن a ما زال نشطًا
    await updateUser(prisma, a, b.id, { name: b.name, roleId: b.roleId, branchIds: [], isActive: false });
    // الآن a هو الوحيد: لا يمكن لأي أحد خفض دوره
    const { actor: other } = await makeActor("SUPER_ADMIN");
    await prisma.user.update({ where: { id: other.id }, data: { isActive: true } });
    await updateUser(prisma, other, a.id, { name: a.name, roleId: await roleId("READ_ONLY"), branchIds: [(await branchByCode("GRN")).id], isActive: true });
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
    // other أصبح الوحيد؛ إعادة تفعيل b ثم محاولة b تعطيل other يجب أن تنجح، لكن تعطيل آخر واحد يفشل
    await prisma.user.update({ where: { id: b.id }, data: { isActive: true } });
    const bSession = await createSession(prisma, b.id);
    const bActor = (await validateSession(prisma, bSession.token))!;
    await updateUser(prisma, bActor, other.id, { name: otherUser.name, roleId: otherUser.roleId, branchIds: [], isActive: false });
    // b الآن الوحيد النشط؛ لا يوجد من يستطيع تعطيله إلا نفسه (ممنوع)
    expect(await prisma.user.count({ where: { isActive: true, role: { key: "SUPER_ADMIN" } } })).toBe(1);
    await expect(updateUser(prisma, bActor, b.id, { name: b.name, roleId: b.roleId, branchIds: [], isActive: false })).rejects.toThrow();
  });

  it("تعطيل مستخدم يلغي جلساته فورًا", async () => {
    const { actor: admin } = await makeActor("SUPER_ADMIN");
    const { user, token } = await makeActor("READ_ONLY", { branchCodes: ["GRN"] });
    expect(await validateSession(prisma, token)).not.toBeNull();
    await updateUser(prisma, admin, user.id, { name: user.name, roleId: user.roleId, branchIds: [(await branchByCode("GRN")).id], isActive: false });
    expect(await validateSession(prisma, token)).toBeNull();
    const log = await prisma.auditLog.findFirst({ where: { action: "user.deactivate", entityId: user.id } });
    expect(log).not.toBeNull();
  });

  it("تغيير فروع المستخدم يسري على الطلب التالي", async () => {
    const { actor: admin } = await makeActor("SUPER_ADMIN");
    const { user, token } = await makeActor("BRANCH_MANAGER", { branchCodes: ["GRN"] });
    const tbk = await branchByCode("TBK");
    await updateUser(prisma, admin, user.id, { name: user.name, roleId: user.roleId, branchIds: [tbk.id], isActive: true });
    const fresh = await validateSession(prisma, token);
    expect(fresh?.branchIds).toEqual([tbk.id]);
  });
});
