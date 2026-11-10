import { z } from "zod";
import type { NotificationType, Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { AppError } from "@/lib/errors";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { addDays, dateOnly, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";

type Tx = Prisma.TransactionClient | Db;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  CONTRACT_EXPIRING: "عقد ينتهي قريبًا",
  PAYMENT_DUE: "دفعة مستحقة",
  PAYMENT_OVERDUE: "دفعة متأخرة",
  CONTRACT_PENDING_APPROVAL: "عقد يحتاج اعتمادًا",
  DOCUMENT_MISSING: "مستند ناقص",
  PAYMENT_PENDING_REVIEW: "تحصيل يحتاج مراجعة",
  SYSTEM: "تنبيه النظام",
};

/**
 * المستلمون حسب الصلاحيات (قرار المواصفات: الإشعارات تظهر حسب صلاحيات المستخدم):
 * مستخدم نشط، دوره يملك الصلاحية المطلوبة، ويغطي الفرع (دور لكل الفروع أو فرع مخصص له).
 */
export async function recipients(tx: Tx, branchId: string, permission: PermissionKey, excludeUserId?: string) {
  const users = await tx.user.findMany({
    where: {
      isActive: true,
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      role: { permissions: { some: { permission: { key: permission } } } },
      OR: [{ role: { allBranches: true } }, { branchAccess: { some: { branchId } } }],
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export type NotifyInput = {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** يمنع تكرار نفس التنبيه لنفس المستخدم */
  dedupeKey: string;
  branchId: string;
  permission: PermissionKey;
  excludeUserId?: string;
};

export async function notify(tx: Tx, n: NotifyInput) {
  const ids = await recipients(tx, n.branchId, n.permission, n.excludeUserId);
  if (!ids.length) return 0;
  const r = await tx.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body ?? null,
      link: n.link ?? null,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
      dedupeKey: n.dedupeKey,
    })),
    skipDuplicates: true,
  });
  return r.count;
}

/** يعلّم تنبيهات أمر انتهى (اعتُمد العقد، رُوجعت الدفعة، سُدد القسط) كمقروءة لجميع المستلمين. */
export async function resolve(tx: Tx, types: NotificationType[], entityIds: string[]) {
  if (!entityIds.length) return 0;
  const r = await tx.notification.updateMany({
    where: { type: { in: types }, entityId: { in: entityIds }, readAt: null },
    data: { readAt: new Date() },
  });
  return r.count;
}

// ───── للمستخدم ─────

export async function unreadCount(db: Db, actor: Actor) {
  return db.notification.count({ where: { userId: actor.id, readAt: null } });
}

const listSchema = z.object({
  filter: z.enum(["unread", "all"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).optional().catch(undefined),
});
export const NOTIFICATIONS_PAGE_SIZE = 30;

export async function listNotifications(db: Db, actor: Actor, raw: unknown) {
  const f = listSchema.parse(raw ?? {});
  const where = { userId: actor.id, ...(f.filter === "unread" ? { readAt: null } : {}) };
  const page = f.page ?? 1;
  const [total, items, unread] = await Promise.all([
    db.notification.count({ where }),
    db.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * NOTIFICATIONS_PAGE_SIZE, take: NOTIFICATIONS_PAGE_SIZE }),
    unreadCount(db, actor),
  ]);
  return { filter: f.filter ?? "all", page, pages: Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE)), items, unread };
}

/** يقرأ المستخدم تنبيهاته فقط — أي معرّف لمستخدم آخر يُعامل كغير موجود. */
export async function markRead(db: Db, actor: Actor, id: string) {
  const n = await db.notification.findFirst({ where: { id, userId: actor.id } });
  if (!n) throw new AppError("NOT_FOUND", "التنبيه غير موجود", 404);
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  // الروابط داخلية فقط (تمنع إعادة التوجيه لموقع خارجي)
  return n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : "/notifications";
}

export async function markAllRead(db: Db, actor: Actor) {
  const r = await db.notification.updateMany({ where: { userId: actor.id, readAt: null }, data: { readAt: new Date() } });
  return r.count;
}

// ───── المهمة اليومية ─────

async function alertDays(db: Db): Promise<number[]> {
  const s = await db.systemSetting.findUnique({ where: { key: "contract.expiry_alert_days" } });
  const v = Array.isArray(s?.value) ? s.value.filter((x): x is number => typeof x === "number" && x > 0 && x <= 365) : [];
  return (v.length ? v : [30, 15, 7]).sort((a, b) => a - b);
}

/**
 * تنبيهات مجدولة — آمنة للتكرار (dedupeKey) وتتحمل تأخر التشغيل:
 * - عقد ينتهي: عند أصغر عتبة (30/15/7 قابلة للتعديل) لم يُرسل لها تنبيه بعد.
 * - دفعة مستحقة اليوم، ودفعة متأخرة (من اليوم التالي للاستحقاق).
 * - مستند ناقص: عقد نشط منذ أكثر من 3 أيام بلا نسخة موقعة.
 * - تُغلق تلقائيًا تنبيهات الأقساط التي سُددت أو أُعفيت أو أُلغيت.
 */
export async function runNotificationJob(db: Db, today = todayInRiyadh()) {
  const days = await alertDays(db);
  const max = days[days.length - 1]!;
  const T = new Date(`${today}T00:00:00Z`).getTime();
  const out = { expiring: 0, due: 0, overdue: 0, missingDocs: 0, resolved: 0 };

  const expiring = await db.contract.findMany({
    where: { status: "ACTIVE", endDate: { gte: dateOnly(today), lte: dateOnly(addDays(today, max)) } },
    include: { tenant: { select: { name: true } }, renewedBy: { select: { status: true } } },
  });
  for (const c of expiring) {
    const left = Math.round((c.endDate.getTime() - T) / 86_400_000);
    const threshold = days.find((d) => left <= d)!;
    const renewal = c.renewedBy && c.renewedBy.status !== "CANCELLED";
    out.expiring += await notify(db, {
      type: "CONTRACT_EXPIRING",
      title: `العقد ${c.contractNo} ينتهي خلال ${left} يومًا`,
      body: `${c.tenant.name} — ${renewal ? "توجد مسودة/عقد تجديد" : "لا يوجد تجديد بعد"}`,
      link: `/contracts/${c.id}`,
      entityType: "contract",
      entityId: c.id,
      dedupeKey: `CONTRACT_EXPIRING:${c.id}:${threshold}`,
      branchId: c.branchId,
      permission: "contracts.create",
    });
  }

  const open = await db.paymentSchedule.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { lte: dateOnly(today) }, contract: { status: { in: ["ACTIVE", "EXPIRED", "TERMINATED", "RENEWED"] } } },
    include: { contract: { select: { id: true, contractNo: true, branchId: true, tenant: { select: { name: true } } } } },
  });
  for (const s of open) {
    const remaining = s.amountDue.minus(s.amountPaid).minus(s.amountAdjusted);
    const isToday = s.dueDate.toISOString().slice(0, 10) === today;
    const n = await notify(db, {
      type: isToday ? "PAYMENT_DUE" : "PAYMENT_OVERDUE",
      title: isToday ? `قسط مستحق اليوم: ${formatSAR(remaining)}` : `قسط متأخر: ${formatSAR(remaining)}`,
      body: `${s.contract.tenant.name} — العقد ${s.contract.contractNo} — القسط ${s.seqNo}`,
      link: `/contracts/${s.contract.id}`,
      entityType: "schedule",
      entityId: s.id,
      dedupeKey: `${isToday ? "PAYMENT_DUE" : "PAYMENT_OVERDUE"}:${s.id}`,
      branchId: s.contract.branchId,
      permission: "payments.record",
    });
    if (isToday) out.due += n;
    else out.overdue += n;
  }

  const missing = await db.contract.findMany({
    where: {
      status: "ACTIVE",
      approvedAt: { lt: new Date(T - 3 * 86_400_000) },
      documents: { none: { category: "CONTRACT_SIGNED", deletedAt: null } },
    },
    include: { tenant: { select: { name: true } } },
  });
  for (const c of missing) {
    out.missingDocs += await notify(db, {
      type: "DOCUMENT_MISSING",
      title: `نسخة العقد الموقعة غير مرفوعة: ${c.contractNo}`,
      body: c.tenant.name,
      link: `/contracts/${c.id}`,
      entityType: "contract",
      entityId: c.id,
      dedupeKey: `DOCUMENT_MISSING:${c.id}`,
      branchId: c.branchId,
      permission: "contracts.approve",
    });
  }

  // إغلاق تلقائي لما لم يعد يحتاج إجراء
  const closed = await db.notification.findMany({
    where: { readAt: null, type: { in: ["PAYMENT_DUE", "PAYMENT_OVERDUE"] } },
    select: { entityId: true },
    distinct: ["entityId"],
  });
  const ids = closed.map((c) => c.entityId).filter((x): x is string => !!x);
  if (ids.length) {
    const done = await db.paymentSchedule.findMany({ where: { id: { in: ids }, status: { in: ["PAID", "WAIVED", "CANCELLED"] } }, select: { id: true } });
    out.resolved += await resolve(db, ["PAYMENT_DUE", "PAYMENT_OVERDUE"], done.map((d) => d.id));
  }
  const openDocAlerts = await db.notification.findMany({ where: { readAt: null, type: "DOCUMENT_MISSING" }, select: { entityId: true }, distinct: ["entityId"] });
  const docIds = openDocAlerts.map((c) => c.entityId).filter((x): x is string => !!x);
  const docsDone = docIds.length
    ? await db.contract.findMany({
        where: { id: { in: docIds }, OR: [{ documents: { some: { category: "CONTRACT_SIGNED", deletedAt: null } } }, { status: { not: "ACTIVE" } }] },
        select: { id: true },
      })
    : [];
  out.resolved += await resolve(db, ["DOCUMENT_MISSING"], docsDone.map((d) => d.id));
  return out;
}
