import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession, validateSession } from "@/lib/auth/session";
import type { RoleKey } from "@/lib/rbac/permissions";
import { dateOnly } from "@/lib/dates";

export { prisma };
export const STRONG = "Str0ng-Passw0rd-2026";

let hashed: string | null = null;
async function pw() {
  return (hashed ??= await hashPassword(STRONG));
}

export function uniqueEmail(prefix = "u") {
  return `${prefix}-${randomUUID().slice(0, 8)}@test.zaki.local`;
}

export async function branchByCode(code: string) {
  return prisma.branch.findUniqueOrThrow({ where: { code } });
}

export async function makeUser(roleKey: RoleKey, opts: { branchCodes?: string[]; isActive?: boolean; email?: string } = {}) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const branches = await prisma.branch.findMany({ where: { code: { in: opts.branchCodes ?? [] } } });
  return prisma.user.create({
    data: {
      email: opts.email ?? uniqueEmail(roleKey.toLowerCase()),
      name: `مستخدم ${roleKey}`,
      roleId: role.id,
      passwordHash: await pw(),
      isActive: opts.isActive ?? true,
      branchAccess: { create: branches.map((b) => ({ branchId: b.id })) },
    },
  });
}

/** ينشئ مستخدمًا وجلسة حقيقية ويُرجع الـ Actor كما تبنيه طبقة الجلسات. */
export async function makeActor(roleKey: RoleKey, opts: { branchCodes?: string[] } = {}) {
  const user = await makeUser(roleKey, opts);
  const { token } = await createSession(prisma, user.id);
  const actor = await validateSession(prisma, token);
  if (!actor) throw new Error("failed to build actor");
  return { user, actor, token };
}

let seq = 0;
/** إدخالات مباشرة لاختبار القيود — وحدات الخدمات الخاصة بها تُبنى في المراحل 2–4 */
export async function makeUnit(branchCode: string, typeKey = "PRIVATE_OFFICE") {
  const branch = await branchByCode(branchCode);
  const type = await prisma.unitType.findUniqueOrThrow({ where: { key: typeKey } });
  return prisma.unit.create({
    data: {
      branchId: branch.id,
      unitTypeId: type.id,
      occupancyMode: type.occupancyMode,
      code: `T-${++seq}-${randomUUID().slice(0, 4)}`,
      basePrice: "1000.00",
      capacity: type.occupancyMode === "SHARED" ? 10 : 1,
    },
  });
}

export async function makeTenant() {
  return prisma.tenant.create({ data: { type: "COMPANY", name: `شركة اختبار ${randomUUID().slice(0, 6)}` } });
}

export async function makeContract(opts: {
  branchId: string;
  tenantId: string;
  start: string;
  end: string;
  status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE";
  total?: string;
}) {
  return prisma.contract.create({
    data: {
      contractNo: `TST-${randomUUID().slice(0, 10)}`,
      tenantId: opts.tenantId,
      branchId: opts.branchId,
      status: opts.status ?? "ACTIVE",
      startDate: dateOnly(opts.start),
      endDate: dateOnly(opts.end),
      billingCycle: "MONTHLY",
      durationMonths: 12,
      rentAmount: opts.total ?? "12000.00",
      totalAmount: opts.total ?? "12000.00",
    },
  });
}

export function linkUnit(contractId: string, unit: { id: string; branchId: string; occupancyMode: "EXCLUSIVE" | "SHARED" }, start: string, end: string, blocks = true) {
  return prisma.contractUnit.create({
    data: {
      contractId,
      unitId: unit.id,
      branchId: unit.branchId,
      price: "1000.00",
      startDate: dateOnly(start),
      endDate: dateOnly(end),
      blocksOccupancy: blocks,
      occupancyMode: unit.occupancyMode,
    },
  });
}
