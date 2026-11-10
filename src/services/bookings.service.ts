import { z } from "zod";
import { Prisma, type BookingPaymentStatus, type BookingStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, branchWhere, requirePermission } from "@/lib/rbac/guard";
import { dateOnly, todayInRiyadh } from "@/lib/dates";
import { money } from "@/lib/money";
import { optionalText, parseInput, phoneSchema } from "@/lib/validation";
import { assertTenantAccess } from "./access";

/**
 * حجوزات قاعات الاجتماعات — قرارات معتمدة:
 * - يحجزها موظف الفرع (bookings.manage) نيابة عن العميل.
 * - ساعتان مجانيتان يوميًا لكل مستأجر لديه عقد نشط، مجموعهما على كل الفروع.
 * - ما زاد يُحسب بسعر ساعة القاعة (شامل الضريبة). الزائر الخارجي يدفع من أول ساعة.
 * - الحجز بالساعة الكاملة من 8 صباحًا إلى 10 مساءً بتوقيت الرياض.
 */
export const OPEN_HOUR = 8;
export const CLOSE_HOUR = 22;
export const FREE_HOURS_PER_DAY = 2;

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = { CONFIRMED: "مؤكد", CANCELLED: "ملغى" };
export const BOOKING_PAYMENT_LABELS: Record<BookingPaymentStatus, string> = { FREE: "مجاني", UNPAID: "غير مسدد", PAID: "مسدد" };
export const BOOKING_PAYMENT_COLOR = { FREE: "blue", UNPAID: "amber", PAID: "green" } as const;

async function freeHoursSetting(db: Db | Prisma.TransactionClient) {
  const s = await db.systemSetting.findUnique({ where: { key: "booking.free_hours_per_day" } });
  return typeof s?.value === "number" && s.value >= 0 && s.value <= 14 ? s.value : FREE_HOURS_PER_DAY;
}

/** الساعة الحالية بتوقيت الرياض */
function riyadhHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hour12: false }).format(now)) % 24;
}

const bookingSchema = z
  .object({
    unitId: z.string().uuid("اختر القاعة"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ غير صحيح"),
    startHour: z.coerce.number().int().min(OPEN_HOUR, "البداية من 8 صباحًا").max(CLOSE_HOUR - 1, "آخر بداية 9 مساءً"),
    hours: z.coerce.number().int("الحجز بالساعة الكاملة").min(1, "ساعة واحدة على الأقل").max(CLOSE_HOUR - OPEN_HOUR),
    customerType: z.enum(["TENANT", "VISITOR"], { message: "حدد نوع العميل" }),
    tenantId: z.string().uuid().optional().nullable().or(z.literal("")),
    visitorName: optionalText(120),
    visitorMobile: phoneSchema,
    notes: optionalText(1000),
  })
  .refine((d) => d.startHour + d.hours <= CLOSE_HOUR, { message: "الحجز يجب أن ينتهي قبل 10 مساءً", path: ["hours"] })
  .refine((d) => (d.customerType === "TENANT" ? !!d.tenantId : !!d.visitorName), { message: "اختر المستأجر أو اكتب اسم الزائر", path: ["tenantId"] });

async function nextBookingNo(tx: Prisma.TransactionClient, branchCode: string, year: string) {
  const key = `BOOKING-${branchCode}-${year}`;
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO number_sequences (key, last_value) VALUES (${key}, 1)
    ON CONFLICT (key) DO UPDATE SET last_value = number_sequences.last_value + 1
    RETURNING last_value`;
  return `BK-${branchCode}-${year}-${String(rows[0]!.last_value).padStart(5, "0")}`;
}

/** هل للمستأجر عقد نشط في هذا التاريخ (شرط الساعات المجانية)؟ */
async function hasActiveContract(db: Db | Prisma.TransactionClient, tenantId: string, date: string) {
  const n = await db.contract.count({ where: { tenantId, status: "ACTIVE", startDate: { lte: dateOnly(date) }, endDate: { gte: dateOnly(date) } } });
  return n > 0;
}

/** الساعات المجانية المستخدمة لمستأجر في يوم (كل الفروع) */
export async function freeHoursUsed(db: Db | Prisma.TransactionClient, tenantId: string, date: string) {
  const r = await db.roomBooking.aggregate({ where: { tenantId, bookingDate: dateOnly(date), status: "CONFIRMED" }, _sum: { freeHours: true } });
  return r._sum.freeHours ?? 0;
}

export async function createBooking(db: Db, actor: Actor, raw: unknown, meta: RequestMeta = {}) {
  requirePermission(actor, "bookings.manage");
  const input = parseInput(bookingSchema, raw);
  const today = todayInRiyadh();
  if (input.date < today || (input.date === today && input.startHour <= riyadhHour() - 1))
    throw new AppError("VALIDATION", "لا يمكن الحجز في وقت مضى");
  const unit = await db.unit.findUnique({ where: { id: input.unitId }, include: { unitType: true, branch: true } });
  if (!unit) throw new NotFoundError("القاعة غير موجودة");
  assertBranchAccess(actor, unit.branchId);
  if (unit.unitType.leaseMode !== "BOOKING") throw new AppError("VALIDATION", "هذه الوحدة لا تُحجز بالساعة");
  if (unit.archivedAt || unit.status === "INACTIVE" || unit.status === "MAINTENANCE") throw new AppError("VALIDATION", `القاعة ${unit.code} غير متاحة حاليًا`);
  if (unit.branch.status === "INACTIVE") throw new AppError("VALIDATION", "الفرع موقوف");
  if (unit.pricingCycle !== "HOUR") throw new AppError("VALIDATION", `سعر القاعة ${unit.code} ليس بالساعة؛ عدّل دورة التسعير في بيانات الوحدة`);
  const isTenant = input.customerType === "TENANT";
  if (isTenant) await assertTenantAccess(db, actor, input.tenantId!);

  const endHour = input.startHour + input.hours;
  try {
    return await db.$transaction(async (tx) => {
      let free = 0;
      if (isTenant) {
        // قفل صف المستأجر يمنع حجزين متزامنين من استهلاك نفس الساعات المجانية
        await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${input.tenantId}::uuid FOR UPDATE`;
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: input.tenantId! } });
        if (t.archivedAt) throw new AppError("VALIDATION", "العميل مؤرشف");
        if (await hasActiveContract(tx, t.id, input.date)) {
          const allowance = await freeHoursSetting(tx);
          free = Math.max(0, Math.min(input.hours, allowance - (await freeHoursUsed(tx, t.id, input.date))));
        }
      }
      const paid = input.hours - free;
      const price = money(unit.basePrice);
      const charge = price.times(paid);
      const bookingNo = await nextBookingNo(tx, unit.branch.code, input.date.slice(0, 4));
      const b = await tx.roomBooking.create({
        data: {
          bookingNo,
          branchId: unit.branchId,
          unitId: unit.id,
          bookingDate: dateOnly(input.date),
          startHour: input.startHour,
          endHour,
          hours: input.hours,
          tenantId: isTenant ? input.tenantId! : null,
          visitorName: isTenant ? null : input.visitorName,
          visitorMobile: isTenant ? null : input.visitorMobile,
          freeHours: free,
          paidHours: paid,
          hourlyPrice: price,
          chargeAmount: charge,
          paymentStatus: charge.gt(0) ? "UNPAID" : "FREE",
          notes: input.notes,
          createdById: actor.id,
        },
      });
      await writeAudit(tx, {
        actorId: actor.id,
        action: "booking.create",
        entityType: "booking",
        entityId: b.id,
        branchId: b.branchId,
        after: { bookingNo, room: unit.code, date: input.date, from: input.startHour, to: endHour, free, paid, charge: charge.toFixed(2) },
        meta,
      });
      return b;
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("room_bookings_no_overlap"))
      throw new AppError("CONFLICT", `القاعة ${unit.code} محجوزة في جزء من هذا الوقت`);
    throw e;
  }
}

/** الإلغاء قبل موعد الحجز، وللحجوزات غير المسددة فقط؛ تعود الساعات المجانية للمستأجر. */
export async function cancelBooking(db: Db, actor: Actor, id: string, reason: string, meta: RequestMeta = {}) {
  requirePermission(actor, "bookings.manage");
  const r = parseInput(z.string().trim().min(3, "اذكر سبب الإلغاء").max(500), reason);
  const b = await db.roomBooking.findUnique({ where: { id }, include: { payments: { where: { status: { in: ["PENDING_REVIEW", "APPROVED"] } } } } });
  if (!b) throw new NotFoundError("الحجز غير موجود");
  assertBranchAccess(actor, b.branchId);
  if (b.status !== "CONFIRMED") throw new AppError("STATE", "الحجز ملغى بالفعل");
  if (b.payments.length) throw new AppError("STATE", "على الحجز دفعة مسجلة أو معتمدة؛ لا يمكن إلغاؤه (لا يوجد استرداد)");
  const date = b.bookingDate.toISOString().slice(0, 10);
  const today = todayInRiyadh();
  if (date < today || (date === today && b.startHour <= riyadhHour())) throw new AppError("STATE", "لا يمكن إلغاء حجز بدأ أو انتهى");
  return db.$transaction(async (tx) => {
    const u = await tx.roomBooking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.id, cancelReason: r } });
    await writeAudit(tx, { actorId: actor.id, action: "booking.cancel", entityType: "booking", entityId: id, branchId: b.branchId, after: { reason: r }, meta });
    return u;
  });
}

// ───── القراءة ─────

export async function bookingDay(db: Db, actor: Actor, raw: unknown) {
  requirePermission(actor, "bookings.view");
  const f = z
    .object({
      branchId: z.string().uuid().optional().catch(undefined),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
    })
    .parse(raw ?? {});
  const branches = await db.branch.findMany({ where: { status: { not: "INACTIVE" }, ...branchWhere(actor, "id") }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } });
  const branchId = f.branchId && branches.some((b) => b.id === f.branchId) ? f.branchId : branches[0]?.id;
  if (branchId) assertBranchAccess(actor, branchId);
  const date = f.date ?? todayInRiyadh();
  const [rooms, bookings] = branchId
    ? await Promise.all([
        db.unit.findMany({
          where: { branchId, archivedAt: null, unitType: { leaseMode: "BOOKING" } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, capacity: true, basePrice: true, pricingCycle: true, status: true, unitType: { select: { nameAr: true } } },
        }),
        db.roomBooking.findMany({
          where: { branchId, bookingDate: dateOnly(date) },
          orderBy: [{ startHour: "asc" }],
          include: { tenant: { select: { id: true, name: true } }, unit: { select: { code: true } } },
        }),
      ])
    : [[], []];
  return { branches, branchId: branchId ?? null, date, rooms, bookings };
}

export async function getBooking(db: Db, actor: Actor, id: string) {
  requirePermission(actor, "bookings.view");
  const b = await db.roomBooking.findUnique({
    where: { id },
    include: {
      tenant: { select: { id: true, name: true, mobile: true } },
      unit: { select: { id: true, code: true } },
      branch: { select: { nameAr: true, code: true } },
      payments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!b) throw new NotFoundError("الحجز غير موجود");
  assertBranchAccess(actor, b.branchId);
  const users = await db.user.findMany({ where: { id: { in: [b.createdById, b.cancelledById].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return { booking: b, userNames: Object.fromEntries(users.map((u) => [u.id, u.name])) as Record<string, string> };
}

/** معاينة الساعات المجانية المتبقية لمستأجر في يوم (للنموذج). */
export async function freeHoursLeft(db: Db, actor: Actor, tenantId: string, date: string) {
  requirePermission(actor, "bookings.view");
  await assertTenantAccess(db, actor, tenantId);
  if (!(await hasActiveContract(db, tenantId, date))) return { eligible: false, left: 0 };
  return { eligible: true, left: Math.max(0, (await freeHoursSetting(db)) - (await freeHoursUsed(db, tenantId, date))) };
}
