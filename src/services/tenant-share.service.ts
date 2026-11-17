import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { requirePermission } from "@/lib/rbac/guard";
import { writeAudit } from "@/lib/audit";
import { generateSessionToken, hashToken } from "@/lib/auth/tokens";
import { loadActor } from "@/lib/auth/load-actor";
import { appUrl } from "@/lib/mail";
import { dateOnly, todayInRiyadh } from "@/lib/dates";
import { assertTenantAccess } from "./access";

/**
 * صفحة المستأجر (رابط بدون حساب): عرض فقط لعقوده وأقساطه ودفعاته المعتمدة.
 * - الرابط سري (يُخزَّن SHA-256 فقط)، له مدة، ويُلغى في أي وقت.
 * - يعرض فقط عقود الفروع التي يملكها منشئ الرابط **حاليًا**؛ لو تعطّل حسابه أو فقد الصلاحية يتوقف الرابط.
 * - لا يظهر أي بيان حساس (الهوية، الملاحظات، المستندات، أسماء الموظفين).
 */
export const SHARE_DAYS = [7, 30, 90] as const;

const createSchema = z.object({ days: z.coerce.number().refine((d) => (SHARE_DAYS as readonly number[]).includes(d), "مدة غير صحيحة") });

function canShare(actor: Actor) {
  requirePermission(actor, "tenants.manage");
  requirePermission(actor, "payments.view");
}

export async function createShareLink(db: Db, actor: Actor, tenantId: string, raw: unknown, meta: RequestMeta = {}) {
  canShare(actor);
  await assertTenantAccess(db, actor, tenantId);
  const { days } = createSchema.parse(raw ?? {});
  const token = generateSessionToken();
  const link = await db.tenantShareLink.create({
    data: { tokenHash: hashToken(token), tenantId, createdById: actor.id, expiresAt: new Date(Date.now() + days * 86_400_000) },
  });
  await writeAudit(db, { actorId: actor.id, action: "tenant.share_link_created", entityType: "tenant", entityId: tenantId, after: { linkId: link.id, days }, meta });
  return { url: appUrl(`/t/${token}`), expiresAt: link.expiresAt };
}

export async function revokeShareLinks(db: Db, actor: Actor, tenantId: string, meta: RequestMeta = {}) {
  canShare(actor);
  await assertTenantAccess(db, actor, tenantId);
  const r = await db.tenantShareLink.updateMany({ where: { tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
  await writeAudit(db, { actorId: actor.id, action: "tenant.share_links_revoked", entityType: "tenant", entityId: tenantId, after: { count: r.count }, meta });
  return r.count;
}

export async function listShareLinks(db: Db, actor: Actor, tenantId: string) {
  if (!actor.permissions.has("tenants.manage") || !actor.permissions.has("payments.view")) return null;
  return db.tenantShareLink.findMany({
    where: { tenantId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true, viewCount: true, lastViewedAt: true, createdBy: { select: { name: true } } },
  });
}

export const SHARE_SCHEDULE_LABELS = { PENDING: "غير مسدد", PARTIAL: "مسدد جزئيًا", PAID: "مسدد", WAIVED: "معفى", CANCELLED: "ملغى" } as const;

/** للصفحة العامة: يرجع null لأي رابط غير صالح (بدون تمييز السبب). */
export async function getSharedTenantView(db: Db, token: string) {
  if (!token || token.length < 20 || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const link = await db.tenantShareLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.revokedAt || link.expiresAt <= new Date()) return null;
  const creator = await loadActor(db, link.createdById);
  if (!creator || !creator.permissions.has("tenants.manage") || !creator.permissions.has("payments.view")) return null;
  const branchFilter = creator.allBranches ? {} : { branchId: { in: [...creator.branchIds] } };

  const tenant = await db.tenant.findUnique({ where: { id: link.tenantId }, select: { id: true, name: true, archivedAt: true } });
  if (!tenant) return null;

  const contracts = await db.contract.findMany({
    where: { tenantId: tenant.id, status: { in: ["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"] }, ...branchFilter },
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      contractNo: true,
      status: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      branch: { select: { nameAr: true } },
      units: { select: { unit: { select: { code: true } } } },
      schedules: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { seqNo: "asc" },
        select: { id: true, seqNo: true, dueDate: true, amountDue: true, amountPaid: true, amountAdjusted: true, status: true },
      },
    },
  });
  const payments = await db.payment.findMany({
    where: { tenantId: tenant.id, status: "APPROVED", receiptNo: { not: null }, ...branchFilter },
    orderBy: { paidOn: "desc" },
    take: 50,
    select: { id: true, receiptNo: true, amount: true, paidOn: true, method: true, contract: { select: { contractNo: true } } },
  });

  await db.tenantShareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } });

  const today = dateOnly(todayInRiyadh()).getTime();
  let due = new Prisma.Decimal(0);
  let overdue = new Prisma.Decimal(0);
  let nextDue: { date: Date; amount: Prisma.Decimal } | null = null;
  for (const c of contracts)
    for (const s of c.schedules) {
      if (s.status !== "PENDING" && s.status !== "PARTIAL") continue;
      const left = s.amountDue.minus(s.amountPaid).minus(s.amountAdjusted);
      const t = s.dueDate.getTime();
      if (t <= today) due = due.plus(left);
      if (t < today) overdue = overdue.plus(left);
      if (t > today && (!nextDue || t < nextDue.date.getTime())) nextDue = { date: s.dueDate, amount: left };
    }

  return { tenant: { name: tenant.name }, contracts, payments, totals: { due, overdue, nextDue }, expiresAt: link.expiresAt };
}
