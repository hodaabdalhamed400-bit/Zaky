import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import type { PermissionKey } from "@/lib/rbac/permissions";
import { addDays, dateOnly, todayInRiyadh } from "@/lib/dates";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { BILLING_CYCLE_LABELS } from "@/lib/contract-pricing";
import { computeOccupancy, unitOccupancyToday } from "./occupancy.service";
import { BRANCH_STATUS_LABELS } from "./branches.service";
import { CONTRACT_STATUS_LABELS } from "./contracts.service";
import { PAYMENT_METHOD_LABELS, payerName } from "./payments.service";
import { TENANT_STATUS_LABELS } from "./tenants.service";
import { effectiveUnitStatus } from "./units.service";
import { overdueReport } from "./finance.service";

/**
 * التقارير — سجل موحد: كل تقرير يعرّف أعمدته وصلاحياته ومرشحاته، ويُستخدم نفس الناتج
 * للعرض والطباعة (PDF) وExcel، فلا تختلف الأرقام بين طرق العرض.
 * كل التقارير مقيدة بفروع المستخدم. البيانات الحساسة (رقم الهوية) لا تدخل أي تقرير.
 */
export type ColType = "text" | "money" | "date" | "int" | "percent";
export type Column = { key: string; header: string; type: ColType };
export type Cell = string | number | Date | null;
export type Row = Record<string, Cell>;
export type ReportResult = { columns: Column[]; rows: Row[]; totals?: Row; note?: string; truncated?: boolean };

export const reportFiltersSchema = z.object({
  branchId: z.string().uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  status: z.string().regex(/^[A-Z_]{2,30}$/).optional().catch(undefined),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;
export type FilterKind = "branch" | "dateRange" | "status";

type Def = {
  title: string;
  description: string;
  perms: PermissionKey[];
  filters: FilterKind[];
  dateLabel?: string;
  statuses?: Record<string, string>;
  run: (db: Db, actor: Actor, f: ReportFilters, ids: string[] | null) => Promise<ReportResult>;
};

export const MAX_ROWS = 5000;
const D = (v: Prisma.Decimal | null | undefined) => new Prisma.Decimal(v ?? 0).toFixed(2);
const sumCol = (rows: Row[], key: string) => rows.reduce((a, r) => a.plus(String(r[key] ?? 0)), new Prisma.Decimal(0)).toFixed(2);
const inBranches = (ids: string[] | null, field = "branchId") => (ids === null ? {} : { [field]: { in: ids } });
const range = (f: ReportFilters) => ({
  ...(f.from ? { gte: dateOnly(f.from) } : {}),
  ...(f.to ? { lte: dateOnly(f.to) } : {}),
});
const hasRange = (f: ReportFilters) => !!(f.from || f.to);

export const REPORTS: Record<string, Def> = {
  branches: {
    title: "تقرير الفروع",
    description: "لكل فرع: الوحدات والإشغال والعقود والمستحقات والمحصّل في الفترة.",
    perms: ["branches.view", "payments.view"],
    filters: ["branch", "dateRange"],
    dateLabel: "فترة التحصيل",
    async run(db, _a, f, ids) {
      const today = todayInRiyadh();
      const from = f.from ?? `${today.slice(0, 7)}-01`;
      const to = f.to ?? today;
      const branches = await db.branch.findMany({ where: { ...(ids === null ? {} : { id: { in: ids } }) }, orderBy: [{ status: "asc" }, { nameAr: "asc" }] });
      const occ = await computeOccupancy(db, branches.map((b) => b.id), today);
      const money = await db.$queryRaw<{ id: string; value: Prisma.Decimal; active: bigint; due: Prisma.Decimal; overdue: Prisma.Decimal; collected: Prisma.Decimal }[]>`
        SELECT b.id,
          COALESCE((SELECT SUM(total_amount) FROM contracts c WHERE c.branch_id = b.id AND c.status = 'ACTIVE'), 0) AS value,
          (SELECT COUNT(*) FROM contracts c WHERE c.branch_id = b.id AND c.status = 'ACTIVE') AS active,
          COALESCE((SELECT SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
            WHERE c.branch_id = b.id AND s.status IN ('PENDING','PARTIAL') AND s.due_date <= ${dateOnly(today)}::date), 0) AS due,
          COALESCE((SELECT SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FROM payment_schedules s JOIN contracts c ON c.id = s.contract_id
            WHERE c.branch_id = b.id AND s.status IN ('PENDING','PARTIAL') AND s.due_date < ${dateOnly(today)}::date), 0) AS overdue,
          COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.branch_id = b.id AND p.status = 'APPROVED'
            AND p.paid_on BETWEEN ${dateOnly(from)}::date AND ${dateOnly(to)}::date), 0) AS collected
        FROM branches b WHERE b.id = ANY(${branches.map((b) => b.id)}::uuid[])`;
      const m = new Map(money.map((x) => [x.id, x]));
      const rows: Row[] = branches.map((b) => {
        const o = occ.get(b.id);
        const x = m.get(b.id);
        return {
          name: b.nameAr,
          status: BRANCH_STATUS_LABELS[b.status],
          manager: b.managerName ? `${b.managerName}${b.managerActing ? " (مؤقت)" : ""}` : "",
          units: o.units,
          occupied: o.occupiedUnits,
          unitsPct: o.unitsPct,
          seatsPct: o.seatsPct,
          active: Number(x?.active ?? 0),
          value: D(x?.value),
          due: D(x?.due),
          overdue: D(x?.overdue),
          collected: D(x?.collected),
        };
      });
      return {
        columns: [
          { key: "name", header: "الفرع", type: "text" },
          { key: "status", header: "الحالة", type: "text" },
          { key: "manager", header: "المدير", type: "text" },
          { key: "units", header: "الوحدات", type: "int" },
          { key: "occupied", header: "المؤجرة", type: "int" },
          { key: "unitsPct", header: "الإشغال (وحدات)", type: "percent" },
          { key: "seatsPct", header: "الإشغال (مقاعد)", type: "percent" },
          { key: "active", header: "عقود نشطة", type: "int" },
          { key: "value", header: "قيمة العقود النشطة", type: "money" },
          { key: "due", header: "المستحق", type: "money" },
          { key: "overdue", header: "المتأخر", type: "money" },
          { key: "collected", header: "المحصّل في الفترة", type: "money" },
        ],
        rows,
        totals: { name: "الإجمالي", units: rows.reduce((a, r) => a + Number(r.units), 0), occupied: rows.reduce((a, r) => a + Number(r.occupied), 0), active: rows.reduce((a, r) => a + Number(r.active), 0), value: sumCol(rows, "value"), due: sumCol(rows, "due"), overdue: sumCol(rows, "overdue"), collected: sumCol(rows, "collected") },
        note: `المحصّل من ${from} إلى ${to}. الإشغال والمستحقات كما في ${today}.`,
      };
    },
  },

  occupancy: {
    title: "تقرير الإشغال",
    description: "كل وحدة قابلة للتأجير: حالتها الفعلية اليوم والمستأجر الحالي ونهاية عقده.",
    perms: ["units.view"],
    filters: ["branch"],
    async run(db, _a, _f, ids) {
      const today = todayInRiyadh();
      const units = await db.unit.findMany({
        where: { archivedAt: null, unitType: { leaseMode: "LEASE" }, ...inBranches(ids) },
        include: {
          branch: { select: { nameAr: true } },
          unitType: { select: { nameAr: true } },
          contractUnits: {
            where: { contract: { status: { in: ["ACTIVE", "TERMINATED", "EXPIRED", "RENEWED"] } }, startDate: { lte: dateOnly(today) }, endDate: { gte: dateOnly(today) } },
            include: { contract: { select: { contractNo: true, tenant: { select: { name: true } } } } },
          },
        },
        orderBy: [{ branch: { nameAr: "asc" } }, { code: "asc" }],
        take: MAX_ROWS + 1,
      });
      const seats = await unitOccupancyToday(db, units.map((u) => u.id), today);
      const rows: Row[] = units.slice(0, MAX_ROWS).map((u) => {
        const s = seats.get(u.id) ?? 0;
        return {
          branch: u.branch.nameAr,
          code: u.code,
          type: u.unitType.nameAr,
          area: u.areaSqm ? u.areaSqm.toFixed(2) : null,
          capacity: u.capacity,
          occupiedSeats: s,
          status: effectiveUnitStatus(u, s).label,
          tenant: u.contractUnits.map((cu) => cu.contract.tenant.name).join("، "),
          contract: u.contractUnits.map((cu) => cu.contract.contractNo).join("، "),
          until: u.contractUnits.length ? new Date(Math.max(...u.contractUnits.map((cu) => cu.endDate.getTime()))) : null,
          price: u.basePrice.toFixed(2),
        };
      });
      const occ = await computeOccupancy(db, ids, today);
      return {
        columns: [
          { key: "branch", header: "الفرع", type: "text" },
          { key: "code", header: "الوحدة", type: "text" },
          { key: "type", header: "النوع", type: "text" },
          { key: "area", header: "المساحة م²", type: "money" },
          { key: "capacity", header: "السعة", type: "int" },
          { key: "occupiedSeats", header: "مقاعد مؤجرة", type: "int" },
          { key: "status", header: "الحالة", type: "text" },
          { key: "tenant", header: "المستأجر الحالي", type: "text" },
          { key: "contract", header: "العقد", type: "text" },
          { key: "until", header: "حتى", type: "date" },
          { key: "price", header: "السعر الأساسي", type: "money" },
        ],
        rows,
        truncated: units.length > MAX_ROWS,
        note: `الإشغال اليوم: ${occ.total.unitsPct ?? "—"}% حسب الوحدات، ${occ.total.seatsPct ?? "—"}% حسب المقاعد${occ.total.unitsWithoutArea ? "" : `، ${occ.total.areaPct ?? "—"}% حسب المساحة`}. قاعات الاجتماعات (حجوزات) غير مشمولة.`,
      };
    },
  },

  tenants: {
    title: "تقرير المستأجرين",
    description: "العملاء وحالاتهم وعقودهم النشطة وأرصدتهم. لا يتضمن رقم الهوية.",
    perms: ["tenants.view", "payments.view"],
    filters: ["branch", "status"],
    statuses: TENANT_STATUS_LABELS,
    async run(db, actor, f, ids) {
      const today = todayInRiyadh();
      const where: Prisma.TenantWhereInput = {
        archivedAt: null,
        ...(f.status && f.status in TENANT_STATUS_LABELS ? { status: f.status as keyof typeof TENANT_STATUS_LABELS } : {}),
        ...(ids === null ? {} : { OR: [{ primaryBranchId: { in: ids } }, { contracts: { some: { branchId: { in: ids } } } }] }),
      };
      const tenants = await db.tenant.findMany({ where, orderBy: { name: "asc" }, take: MAX_ROWS + 1, include: { primaryBranch: { select: { nameAr: true } } } });
      const tIds = tenants.map((t) => t.id);
      const bal = tIds.length
        ? await db.$queryRaw<{ tenant_id: string; active: bigint; due: Prisma.Decimal; overdue: Prisma.Decimal }[]>`
            SELECT c.tenant_id,
              COUNT(DISTINCT c.id) FILTER (WHERE c.status = 'ACTIVE') AS active,
              COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FILTER (WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date <= ${dateOnly(today)}::date), 0) AS due,
              COALESCE(SUM(s.amount_due - s.amount_paid - s.amount_adjusted) FILTER (WHERE s.status IN ('PENDING','PARTIAL') AND s.due_date < ${dateOnly(today)}::date), 0) AS overdue
            FROM contracts c LEFT JOIN payment_schedules s ON s.contract_id = c.id
            WHERE c.tenant_id = ANY(${tIds}::uuid[]) ${ids === null ? Prisma.empty : Prisma.sql`AND c.branch_id = ANY(${ids}::uuid[])`}
            GROUP BY c.tenant_id`
        : [];
      const b = new Map(bal.map((x) => [x.tenant_id, x]));
      void actor;
      const rows: Row[] = tenants.slice(0, MAX_ROWS).map((t) => ({
        name: t.name,
        type: t.type === "COMPANY" ? "منشأة" : "فرد",
        branch: t.primaryBranch?.nameAr ?? "",
        status: TENANT_STATUS_LABELS[t.status],
        mobile: t.mobile,
        email: t.email,
        cr: t.crNumber,
        vat: t.vatNumber,
        active: Number(b.get(t.id)?.active ?? 0),
        due: D(b.get(t.id)?.due),
        overdue: D(b.get(t.id)?.overdue),
      }));
      return {
        columns: [
          { key: "name", header: "العميل", type: "text" },
          { key: "type", header: "النوع", type: "text" },
          { key: "branch", header: "الفرع", type: "text" },
          { key: "status", header: "الحالة", type: "text" },
          { key: "mobile", header: "الجوال", type: "text" },
          { key: "email", header: "البريد", type: "text" },
          { key: "cr", header: "السجل التجاري", type: "text" },
          { key: "vat", header: "الرقم الضريبي", type: "text" },
          { key: "active", header: "عقود نشطة", type: "int" },
          { key: "due", header: "المستحق", type: "money" },
          { key: "overdue", header: "المتأخر", type: "money" },
        ],
        rows,
        truncated: tenants.length > MAX_ROWS,
        totals: { name: "الإجمالي", active: rows.reduce((a, r) => a + Number(r.active), 0), due: sumCol(rows, "due"), overdue: sumCol(rows, "overdue") },
      };
    },
  },

  contracts: {
    title: "تقرير العقود",
    description: "العقود حسب الحالة والفترة (تاريخ البداية).",
    perms: ["contracts.view"],
    filters: ["branch", "status", "dateRange"],
    dateLabel: "تاريخ البداية",
    statuses: CONTRACT_STATUS_LABELS,
    async run(db, _a, f, ids) {
      const contracts = await db.contract.findMany({
        where: {
          ...inBranches(ids),
          ...(f.status && f.status in CONTRACT_STATUS_LABELS ? { status: f.status as keyof typeof CONTRACT_STATUS_LABELS } : {}),
          ...(hasRange(f) ? { startDate: range(f) } : {}),
        },
        orderBy: [{ startDate: "desc" }],
        take: MAX_ROWS + 1,
        include: { tenant: { select: { name: true } }, branch: { select: { nameAr: true } }, units: { include: { unit: { select: { code: true } } } } },
      });
      const rows: Row[] = contracts.slice(0, MAX_ROWS).map((c) => ({
        no: c.contractNo,
        tenant: c.tenant.name,
        branch: c.branch.nameAr,
        units: c.units.map((u) => u.unit.code).join("، "),
        start: c.startDate,
        end: c.endDate,
        months: c.durationMonths,
        cycle: BILLING_CYCLE_LABELS[c.billingCycle],
        total: c.totalAmount.toFixed(2),
        vat: c.vatAmount.toFixed(2),
        status: CONTRACT_STATUS_LABELS[c.status],
      }));
      return {
        columns: [
          { key: "no", header: "رقم العقد", type: "text" },
          { key: "tenant", header: "المستأجر", type: "text" },
          { key: "branch", header: "الفرع", type: "text" },
          { key: "units", header: "الوحدات", type: "text" },
          { key: "start", header: "البداية", type: "date" },
          { key: "end", header: "النهاية", type: "date" },
          { key: "months", header: "المدة (شهر)", type: "int" },
          { key: "cycle", header: "الدفع", type: "text" },
          { key: "total", header: "الإجمالي شامل الضريبة", type: "money" },
          { key: "vat", header: "منها ضريبة", type: "money" },
          { key: "status", header: "الحالة", type: "text" },
        ],
        rows,
        truncated: contracts.length > MAX_ROWS,
        totals: { no: "الإجمالي", total: sumCol(rows, "total"), vat: sumCol(rows, "vat") },
        note: "قيمة العقد التزام تعاقدي، وليست مبلغًا محصلًا ولا إيرادًا محاسبيًا.",
      };
    },
  },

  collections: {
    title: "تقرير التحصيل",
    description: "الدفعات المعتمدة في الفترة (حسب تاريخ الدفع) مع أرقام الإيصالات.",
    perms: ["payments.view"],
    filters: ["branch", "dateRange"],
    dateLabel: "تاريخ الدفع",
    async run(db, _a, f, ids) {
      const today = todayInRiyadh();
      const from = f.from ?? `${today.slice(0, 7)}-01`;
      const to = f.to ?? today;
      const payments = await db.payment.findMany({
        where: { status: "APPROVED", paidOn: { gte: dateOnly(from), lte: dateOnly(to) }, ...inBranches(ids) },
        orderBy: [{ paidOn: "asc" }, { receiptNo: "asc" }],
        take: MAX_ROWS + 1,
        include: { tenant: { select: { name: true } }, branch: { select: { nameAr: true } }, contract: { select: { contractNo: true } }, booking: { select: { bookingNo: true, visitorName: true } } },
      });
      const rows: Row[] = payments.slice(0, MAX_ROWS).map((p) => ({
        receipt: p.receiptNo,
        date: p.paidOn,
        tenant: payerName(p),
        contract: p.contract?.contractNo ?? (p.booking ? `حجز ${p.booking.bookingNo}` : ""),
        branch: p.branch.nameAr,
        method: PAYMENT_METHOD_LABELS[p.method],
        ref: p.referenceNo,
        amount: p.amount.toFixed(2),
      }));
      return {
        columns: [
          { key: "receipt", header: "رقم الإيصال", type: "text" },
          { key: "date", header: "تاريخ الدفع", type: "date" },
          { key: "tenant", header: "المستأجر", type: "text" },
          { key: "contract", header: "العقد / الحجز", type: "text" },
          { key: "branch", header: "الفرع", type: "text" },
          { key: "method", header: "الوسيلة", type: "text" },
          { key: "ref", header: "المرجع", type: "text" },
          { key: "amount", header: "المبلغ شامل الضريبة", type: "money" },
        ],
        rows,
        truncated: payments.length > MAX_ROWS,
        totals: { receipt: "الإجمالي", amount: sumCol(rows, "amount") },
        note: `من ${from} إلى ${to}. الدفعات المعلقة والمرفوضة والمعكوسة غير مشمولة.`,
      };
    },
  },

  overdue: {
    title: "تقرير المتأخرات",
    description: "العقود التي عليها أقساط تجاوزت يوم استحقاقها، مرتبة حسب الأقدم.",
    perms: ["payments.view"],
    filters: ["branch"],
    async run(db, actor, f) {
      const rows = await overdueReport(db, actor, { branchId: f.branchId });
      const out: Row[] = rows.map((r) => ({ tenant: r.tenant, mobile: r.mobile, contract: r.contractNo, branch: r.branch, overdue: r.overdue, installments: r.installments, oldest: r.oldestDue, days: r.daysLate }));
      return {
        columns: [
          { key: "tenant", header: "المستأجر", type: "text" },
          { key: "mobile", header: "الجوال", type: "text" },
          { key: "contract", header: "العقد", type: "text" },
          { key: "branch", header: "الفرع", type: "text" },
          { key: "overdue", header: "المتأخر", type: "money" },
          { key: "installments", header: "عدد الأقساط", type: "int" },
          { key: "oldest", header: "أقدم استحقاق", type: "date" },
          { key: "days", header: "أيام التأخير", type: "int" },
        ],
        rows: out,
        totals: { tenant: "الإجمالي", overdue: sumCol(out, "overdue"), installments: out.reduce((a, r) => a + Number(r.installments), 0) },
      };
    },
  },

  expired: {
    title: "تقرير العقود المنتهية",
    description: "العقود المنتهية والمنهاة مبكرًا والمجددة خلال الفترة، مع حالة التجديد وسبب الإنهاء.",
    perms: ["contracts.view"],
    filters: ["branch", "dateRange"],
    dateLabel: "تاريخ الانتهاء",
    async run(db, _a, f, ids) {
      const today = todayInRiyadh();
      const from = f.from ?? addDays(today, -90);
      const to = f.to ?? today;
      const contracts = await db.contract.findMany({
        where: { status: { in: ["EXPIRED", "TERMINATED", "RENEWED"] }, endedAt: { gte: dateOnly(from), lte: dateOnly(to) }, ...inBranches(ids) },
        orderBy: { endedAt: "desc" },
        take: MAX_ROWS + 1,
        include: { tenant: { select: { name: true } }, branch: { select: { nameAr: true } }, renewedBy: { select: { contractNo: true, status: true } } },
      });
      const rows: Row[] = contracts.slice(0, MAX_ROWS).map((c) => ({
        no: c.contractNo,
        tenant: c.tenant.name,
        branch: c.branch.nameAr,
        ended: c.endedAt,
        status: CONTRACT_STATUS_LABELS[c.status],
        policy: c.earlyExitPolicy === "CANCEL_FUTURE" ? "أُلغيت الأقساط القادمة" : c.earlyExitPolicy === "KEEP_DUE" ? "بقيت الأقساط مستحقة" : "",
        reason: c.endReason,
        renewal: c.renewedBy && c.renewedBy.status !== "CANCELLED" ? `${c.renewedBy.contractNo} (${CONTRACT_STATUS_LABELS[c.renewedBy.status]})` : "",
        total: c.totalAmount.toFixed(2),
      }));
      return {
        columns: [
          { key: "no", header: "رقم العقد", type: "text" },
          { key: "tenant", header: "المستأجر", type: "text" },
          { key: "branch", header: "الفرع", type: "text" },
          { key: "ended", header: "تاريخ الانتهاء", type: "date" },
          { key: "status", header: "الحالة", type: "text" },
          { key: "policy", header: "الأقساط عند الإنهاء", type: "text" },
          { key: "reason", header: "السبب", type: "text" },
          { key: "renewal", header: "التجديد", type: "text" },
          { key: "total", header: "قيمة العقد", type: "money" },
        ],
        rows,
        truncated: contracts.length > MAX_ROWS,
        note: `من ${from} إلى ${to}.`,
      };
    },
  },

  activity: {
    title: "تقرير نشاط الموظفين",
    description: "عدد العمليات لكل موظف ونوع العملية خلال الفترة، من سجل التدقيق.",
    perms: ["audit.view"],
    filters: ["branch", "dateRange"],
    dateLabel: "الفترة",
    async run(db, _a, f, ids) {
      const today = todayInRiyadh();
      const from = f.from ?? addDays(today, -30);
      const to = f.to ?? today;
      // نهاية اليوم بتوقيت الرياض (UTC+3)
      const start = new Date(`${from}T00:00:00+03:00`);
      const end = new Date(`${addDays(to, 1)}T00:00:00+03:00`);
      const rows = await db.$queryRaw<{ name: string | null; email: string | null; action: string; n: bigint; last: Date }[]>`
        SELECT u.name, u.email, a.action, COUNT(*) AS n, MAX(a.created_at) AS last
        FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= ${start} AND a.created_at < ${end}
          AND a.action NOT IN ('auth.login_failed')
          ${ids === null ? Prisma.empty : Prisma.sql`AND a.branch_id = ANY(${ids}::uuid[])`}
        GROUP BY u.name, u.email, a.action
        ORDER BY u.name NULLS LAST, n DESC`;
      const out: Row[] = rows.map((r) => ({ user: r.name ?? "النظام", email: r.email, action: AUDIT_ACTION_LABELS[r.action] ?? r.action, count: Number(r.n), last: r.last }));
      return {
        columns: [
          { key: "user", header: "الموظف", type: "text" },
          { key: "email", header: "البريد", type: "text" },
          { key: "action", header: "العملية", type: "text" },
          { key: "count", header: "العدد", type: "int" },
          { key: "last", header: "آخر مرة", type: "date" },
        ],
        rows: out,
        totals: { user: "الإجمالي", count: out.reduce((a, r) => a + Number(r.count), 0) },
        note: `من ${from} إلى ${to}.${ids === null ? "" : " عند تحديد فروع تُعرض العمليات المرتبطة بفرع فقط (تسجيل الدخول وإدارة المستخدمين غير مرتبطة بفرع)."}`,
      };
    },
  },
};

export type ReportKey = keyof typeof REPORTS;

export function canViewReport(actor: Actor, key: string) {
  const def = REPORTS[key];
  return !!def && actor.permissions.has("reports.view") && def.perms.every((p) => actor.permissions.has(p));
}

export async function runReport(db: Db, actor: Actor, key: string, raw: unknown, opts: { forExport?: boolean } = {}) {
  const def = REPORTS[key];
  if (!def) throw new NotFoundError("التقرير غير موجود");
  requirePermission(actor, "reports.view");
  if (opts.forExport) requirePermission(actor, "reports.export");
  if (!def.perms.every((p) => actor.permissions.has(p))) throw new ForbiddenError("ليست لديك صلاحية على بيانات هذا التقرير");
  const f = reportFiltersSchema.parse(raw ?? {});
  if (f.branchId) assertBranchAccess(actor, f.branchId);
  const ids = f.branchId ? [f.branchId] : actor.allBranches ? null : [...actor.branchIds];
  const result = await def.run(db, actor, f, ids);
  return { key, def, filters: f, ...result };
}
