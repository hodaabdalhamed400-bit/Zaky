import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { addDays, dateOnly, formatDate, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";

/**
 * تذكير الدفع عبر واتساب — مجاني ويدوي:
 * النظام يجهّز الرسالة ويفتح واتساب على جوال/جهاز الموظف، والموظف يضغط «إرسال».
 * لا يوجد أي اتصال بخدمة رسائل مدفوعة، ولا يُرسل شيء تلقائيًا.
 */

const OPEN = ["PENDING", "PARTIAL"] as const;
export const UPCOMING_DAYS = 7;
const COMPANY = "شركة ذكي لحاضنات ومسرعات الأعمال";

/** تحويل رقم الجوال إلى الصيغة الدولية التي يقبلها wa.me (أرقام فقط، بدون + أو أصفار بادئة) */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (/^05\d{8}$/.test(d)) d = "966" + d.slice(1);
  else if (/^5\d{8}$/.test(d)) d = "966" + d;
  else if (/^9660\d{9}$/.test(d)) d = "966" + d.slice(4);
  return /^\d{10,15}$/.test(d) ? d : null;
}

async function companyPhone(db: Db) {
  const s = await db.systemSetting.findUnique({ where: { key: "company.phone" } });
  return typeof s?.value === "string" && s.value.trim() ? s.value.trim() : null;
}

const remaining = (s: { amountDue: Prisma.Decimal; amountPaid: Prisma.Decimal; amountAdjusted: Prisma.Decimal }) =>
  s.amountDue.minus(s.amountPaid).minus(s.amountAdjusted);

/** صياغة عدد الأقساط بالعربية: قسطان / 3 أقساط / 11 قسطًا */
export function installmentsAr(n: number) {
  if (n === 1) return "قسط واحد";
  if (n === 2) return "قسطان";
  if (n >= 3 && n <= 10) return `${n} أقساط`;
  return `${n} قسطًا`;
}

export type ReminderKind = "OVERDUE" | "DUE_TODAY" | "UPCOMING";

/** يبني رسالة التذكير لعقد: المتأخر أولًا، وإلا أقرب قسط قادم */
export async function buildPaymentReminder(db: Db, actor: Actor, contractId: string) {
  requirePermission(actor, "payments.view");
  const c = await db.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      contractNo: true,
      branchId: true,
      tenant: { select: { name: true, mobile: true } },
      branch: { select: { nameAr: true } },
      schedules: {
        where: { status: { in: [...OPEN] } },
        orderBy: { dueDate: "asc" },
        select: { seqNo: true, dueDate: true, amountDue: true, amountPaid: true, amountAdjusted: true },
      },
    },
  });
  if (!c) throw new NotFoundError("العقد غير موجود");
  assertBranchAccess(actor, c.branchId);

  const phone = toWhatsAppNumber(c.tenant.mobile);
  if (!phone) throw new AppError("NO_MOBILE", "لا يوجد رقم جوال صالح للمستأجر — أضفه من صفحة المستأجر أولًا", 422);

  const today = dateOnly(todayInRiyadh()).getTime();
  const open = c.schedules.filter((s) => remaining(s).gt(0));
  const overdue = open.filter((s) => s.dueDate.getTime() < today);
  const next = open.find((s) => s.dueDate.getTime() >= today);
  const hotline = await companyPhone(db);

  let kind: ReminderKind;
  let amount: Prisma.Decimal;
  let body: string;
  const first = overdue[0];
  if (first) {
    kind = "OVERDUE";
    amount = overdue.reduce((a, s) => a.plus(remaining(s)), new Prisma.Decimal(0));
    body =
      `نود تذكيركم بوجود مبلغ متأخر قدره ${formatSAR(amount)} على العقد رقم ${c.contractNo} في فرع ${c.branch.nameAr}` +
      (overdue.length > 1 ? ` (${installmentsAr(overdue.length)}، أقدمها مستحق بتاريخ ${formatDate(first.dueDate)}).` : ` (مستحق بتاريخ ${formatDate(first.dueDate)}).`) +
      (next && next.dueDate.getTime() <= dateOnly(addDays(todayInRiyadh(), UPCOMING_DAYS)).getTime()
        ? `\nبالإضافة إلى القسط رقم ${next.seqNo} بمبلغ ${formatSAR(remaining(next))} ${next.dueDate.getTime() === today ? "المستحق اليوم" : `المستحق بتاريخ ${formatDate(next.dueDate)}`}.`
        : "") +
      `\nنرجو التكرم بالسداد في أقرب وقت.`;
  } else if (next) {
    amount = remaining(next);
    kind = next.dueDate.getTime() === today ? "DUE_TODAY" : "UPCOMING";
    body =
      kind === "DUE_TODAY"
        ? `نود تذكيركم بأن القسط رقم ${next.seqNo} بمبلغ ${formatSAR(amount)} على العقد رقم ${c.contractNo} في فرع ${c.branch.nameAr} مستحق اليوم ${formatDate(next.dueDate)}.`
        : `نود تذكيركم بأن القسط رقم ${next.seqNo} بمبلغ ${formatSAR(amount)} على العقد رقم ${c.contractNo} في فرع ${c.branch.nameAr} يستحق بتاريخ ${formatDate(next.dueDate)}.`;
  } else {
    throw new AppError("NOTHING_DUE", "لا توجد أقساط مستحقة على هذا العقد", 422);
  }

  const text = [`السلام عليكم ${c.tenant.name}،`, body, hotline ? `للاستفسار: ${hotline}` : null, `مع التحية،\n${COMPANY}`]
    .filter(Boolean)
    .join("\n");
  return { contract: c, kind, amount, phone, text, url: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` };
}

/** يبني الرسالة ويسجّل في سجل التدقيق من أرسل التذكير ومتى */
export async function logWhatsAppReminder(db: Db, actor: Actor, contractId: string, meta?: RequestMeta) {
  const r = await buildPaymentReminder(db, actor, contractId);
  await writeAudit(db, {
    actorId: actor.id,
    action: "reminder.whatsapp",
    entityType: "contract",
    entityId: r.contract.id,
    branchId: r.contract.branchId,
    after: { kind: r.kind, amount: r.amount.toFixed(2) },
    meta,
  });
  return r;
}

/** أقساط تستحق خلال الأيام القادمة (للتذكير المسبق) */
export async function upcomingInstallments(db: Db, actor: Actor, opts: { branchId?: string; days?: number } = {}) {
  requirePermission(actor, "payments.view");
  if (opts.branchId) assertBranchAccess(actor, opts.branchId);
  const T = todayInRiyadh();
  const rows = await db.paymentSchedule.findMany({
    where: {
      status: { in: [...OPEN] },
      dueDate: { gte: dateOnly(T), lte: dateOnly(addDays(T, opts.days ?? UPCOMING_DAYS)) },
      contract: opts.branchId ? { branchId: opts.branchId } : actor.allBranches ? {} : { branchId: { in: [...actor.branchIds] } },
    },
    orderBy: { dueDate: "asc" },
    take: 200,
    select: {
      id: true,
      seqNo: true,
      dueDate: true,
      amountDue: true,
      amountPaid: true,
      amountAdjusted: true,
      contract: { select: { id: true, contractNo: true, tenant: { select: { id: true, name: true, mobile: true } }, branch: { select: { nameAr: true } } } },
    },
  });
  const today = dateOnly(T).getTime();
  return rows
    .map((s) => ({ ...s, remaining: remaining(s), daysLeft: Math.round((s.dueDate.getTime() - today) / 86_400_000) }))
    .filter((s) => s.remaining.gt(0));
}

/** رابط زر التذكير داخل النظام (يمر بالخادم لتسجيل التدقيق ثم يحوّل إلى واتساب) */
export const reminderHref = (contractId: string) => `/api/reminders/whatsapp/${contractId}`;
