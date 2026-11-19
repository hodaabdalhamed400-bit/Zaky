import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { Prisma, type PricingCycle, type TenantStatus, type UnitStatus } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, NotFoundError, toSafeMessage } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { todayInRiyadh } from "@/lib/dates";
import { computeContract } from "@/lib/contract-pricing";
import { money } from "@/lib/money";
import { approveContract, createContract, submitForApproval } from "./contracts.service";
import { approvePayment, recordPayment } from "./payments.service";

/**
 * استيراد بيانات فرع من شيت «بيانات الفرع» (القالب الموحد: الوحدات، العملاء، العقود، السداد).
 * - المعاينة لا تكتب شيئًا: تقرأ الملف وتتحقق من كل سطر وتعرض ما سيُضاف.
 * - التنفيذ يعيد القراءة والتحقق من نفس الملف، ويرفض إن وُجدت أخطاء.
 * - إعادة رفع نفس الملف آمنة: الموجود مسبقًا (وحدة بنفس الرقم، عميل بنفس الاسم، عقد قائم للوحدة نفسها) يُتجاوز ولا يتكرر.
 * - العقود تمر بنفس مسار النظام (إنشاء ← إرسال ← اعتماد) فتُبنى أقساطها بنفس الحسابات، والمسدد يُسجل كدفعة معتمدة توزع على الأقدم.
 */

export const IMPORT_PERMISSIONS = ["units.manage", "tenants.manage", "contracts.create", "contracts.approve", "payments.record", "payments.approve"] as const;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type Level = "error" | "warning";
export type ImportIssue = {
  sheet: string;
  row: number | null;
  level: Level;
  message: string;
};
type Action = "create" | "exists";

export type ImportPreview = {
  branch: { id: string; name: string; code: string };
  units: {
    row: number;
    code: string;
    type: string;
    floor: string | null;
    capacity: number | null;
    price: string | null;
    cycle: string | null;
    status: string;
    action: Action;
  }[];
  floors: string[];
  tenants: {
    row: number;
    name: string;
    type: string;
    mobile: string | null;
    status: string;
    action: Action;
  }[];
  contracts: {
    ref: string;
    rows: number[];
    tenant: string;
    units: string[];
    start: string | null;
    end: string | null;
    months: number | null;
    cycle: string | null;
    monthly: string;
    total: string | null;
    paid: string;
    installments: number;
    action: Action;
  }[];
  issues: ImportIssue[];
  errors: number;
  warnings: number;
};

// ───── قراءة الخلايا ─────

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
type Cell = ExcelJS.CellValue;

function raw(v: Cell): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("formula" in v || "sharedFormula" in v || "result" in v) return raw((v as { result?: Cell }).result ?? null);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    if ("text" in v) return (v as { text: string }).text;
    if ("error" in v) return null;
  }
  return v;
}
function text(v: Cell): string | null {
  const r = raw(v);
  if (r === null || r === undefined) return null;
  if (r instanceof Date) return r.toISOString().slice(0, 10);
  const s = String(r)
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/\s+/g, " ")
    .trim();
  return s ? s : null;
}
function num(v: Cell): number | null | "bad" {
  const r = raw(v);
  if (r === null || r === undefined || r === "") return null;
  if (typeof r === "number") return Number.isFinite(r) ? r : "bad";
  const s = text(v)
    ?.replace(/[,،\s]/g, "")
    .replace("ر.س", "");
  if (!s) return null;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : "bad";
}
function ymd(v: Cell): string | null | "bad" {
  const r = raw(v);
  if (r === null || r === undefined || r === "") return null;
  if (r instanceof Date) return Number.isNaN(r.getTime()) ? "bad" : r.toISOString().slice(0, 10);
  if (typeof r === "number" && r > 20000 && r < 80000) return new Date(Date.UTC(1899, 11, 30) + r * 86_400_000).toISOString().slice(0, 10);
  const s = text(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); // يوم/شهر/سنة
  if (m) return valid(+m[3]!, +m[2]!, +m[1]!);
  return "bad";
}
function valid(y: number, mo: number, d: number) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (y < 2000 || y > 2100 || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "bad" as const;
  return dt.toISOString().slice(0, 10);
}
const digitsOnly = (s: string | null) => (s ? s.replace(/[\s-]/g, "") : null);

/** توحيد الكتابة للمطابقة بين الشيتات: الهمزات، التاء المربوطة، الألف المقصورة، التطويل والمسافات */
export function normName(s: string | null | undefined) {
  return (s ?? "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// ───── قواميس القوائم المنسدلة ─────

const CYCLES: Record<string, PricingCycle> = {
  شهري: "MONTH",
  سنوي: "YEAR",
  يومي: "DAY",
  بالساعه: "HOUR",
  ساعه: "HOUR",
};
const BILLING: Record<string, "MONTHLY" | "QUARTERLY" | "SEMI_ANNUAL" | "ANNUAL"> = {
  شهري: "MONTHLY",
  "ربع سنوي": "QUARTERLY",
  "نصف سنوي": "SEMI_ANNUAL",
  سنوي: "ANNUAL",
};
const BILLING_AR = {
  MONTHLY: "شهري",
  QUARTERLY: "ربع سنوي",
  SEMI_ANNUAL: "نصف سنوي",
  ANNUAL: "سنوي",
} as const;
const UNIT_STATUS: Record<string, UnitStatus> = {
  متاحه: "AVAILABLE",
  مؤجره: "AVAILABLE",
  محجوزه: "RESERVED",
  صيانه: "MAINTENANCE",
  "غير نشطه": "INACTIVE",
};
const TENANT_TYPE: Record<string, "COMPANY" | "INDIVIDUAL"> = {
  منشاه: "COMPANY",
  شركه: "COMPANY",
  فرد: "INDIVIDUAL",
};
const TENANT_STATUS: Record<string, TenantStatus> = {
  نشط: "ACTIVE",
  سابق: "FORMER",
  محتمل: "PROSPECT",
};

// ───── قراءة الشيت ─────

type Sheet = {
  name: string;
  rows: { n: number; get: (header: RegExp) => Cell; branch: string | null }[];
};

const SHEETS = {
  units: "الوحدات",
  tenants: "العملاء",
  contracts: "العقود",
  payments: "السداد",
} as const;
// صفوف المثال في القالب (الصف الرمادي) — لا تُستورد
const EXAMPLES = [/^شركة المثال/, /^مطل على الشارع$/, /^دفع القسط الأول نقدًا$/];

async function readWorkbook(bytes: Uint8Array) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    throw new AppError("VALIDATION", "تعذّرت قراءة الملف. ارفع ملف Excel بصيغة ‎.xlsx‎ (قالب بيانات الفرع).");
  }
  const read = (name: string): Sheet | null => {
    const ws = wb.worksheets.find((w) => normName(w.name) === normName(name));
    if (!ws) return null;
    // سطر العناوين: أول سطر في أول 6 أسطر يحتوي علامة «*» (الحقول الإجبارية)
    let headerRow = 3;
    for (let r = 1; r <= 6; r++) {
      const vals = (ws.getRow(r).values as Cell[]).map((v) => text(v) ?? "");
      if (vals.some((v) => v.includes("*"))) {
        headerRow = r;
        break;
      }
    }
    const headers = (ws.getRow(headerRow).values as Cell[]).map((v) => normName(text(v)));
    const col = (re: RegExp) => headers.findIndex((h) => re.test(h));
    const branchCol = col(/^الفرع/);
    const rows: Sheet["rows"] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      // ما كتبه الموظف فقط: أعمدة الصيغ (التلقائية) لا تجعل السطر غير فارغ
      const isFormula = (v: Cell) => !!v && typeof v === "object" && !(v instanceof Date) && ("formula" in v || "sharedFormula" in v);
      const values = (row.values as Cell[]).map((v, i) => (i === branchCol || isFormula(v) ? null : text(v)));
      if (!values.some(Boolean)) continue; // سطر فارغ (أو فيه الأعمدة التلقائية فقط)
      if (
        (row.values as Cell[]).some((v) => {
          const t = text(v);
          return !!t && EXAMPLES.some((re) => re.test(t));
        })
      )
        continue;
      rows.push({
        n: r,
        get: (re) => {
          const c = col(re);
          return c > 0 ? row.getCell(c).value : null;
        },
        branch: branchCol > 0 ? text(row.getCell(branchCol).value) : null,
      });
    }
    return { name, rows };
  };
  return {
    units: read(SHEETS.units),
    tenants: read(SHEETS.tenants),
    contracts: read(SHEETS.contracts),
    payments: read(SHEETS.payments),
  };
}

// ───── التحليل والتحقق ─────

type UnitPlan = {
  row: number;
  code: string;
  unitTypeId: string;
  typeName: string;
  leaseMode: string;
  occupancyMode: string;
  floor: string | null;
  area: string | null;
  capacity: number;
  price: string;
  cycle: PricingCycle;
  status: UnitStatus;
  rented: boolean;
  notes: string | null;
  existingId: string | null;
};
type TenantPlan = {
  row: number;
  name: string;
  type: "COMPANY" | "INDIVIDUAL";
  contact: string | null;
  mobile: string | null;
  email: string | null;
  cr: string | null;
  vat: string | null;
  nationalId: string | null;
  address: string | null;
  status: TenantStatus;
  notes: string | null;
  existingId: string | null;
};
type ContractPlan = {
  ref: string;
  rows: number[];
  paperNo: string | null;
  tenantKey: string;
  tenantName: string;
  start: string;
  end: string;
  months: number;
  cycle: keyof typeof BILLING_AR;
  lines: { unitCode: string; seats: number; monthly: string }[];
  notes: string | null;
  total: Prisma.Decimal;
  installments: { seqNo: number; dueDate: string; amountDue: Prisma.Decimal }[];
  paid: Prisma.Decimal;
  paidOn: string | null;
  existing: boolean;
};

async function analyze(db: Db, actor: Actor, branchId: string, bytes: Uint8Array) {
  for (const p of IMPORT_PERMISSIONS) requirePermission(actor, p);
  assertBranchAccess(actor, branchId);
  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) throw new NotFoundError("الفرع غير موجود");
  if (branch.status === "INACTIVE") throw new AppError("VALIDATION", "لا يمكن الاستيراد إلى فرع موقوف");
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new AppError("VALIDATION", "حجم الملف أكبر من 5 ميجابايت");

  const book = await readWorkbook(bytes);
  const issues: ImportIssue[] = [];
  const err = (sheet: string, row: number | null, message: string) => issues.push({ sheet, row, level: "error", message });
  const warn = (sheet: string, row: number | null, message: string) => issues.push({ sheet, row, level: "warning", message });
  const today = todayInRiyadh();

  if (!book.units && !book.tenants && !book.contracts) throw new AppError("VALIDATION", "الملف لا يحتوي شيتات «الوحدات» و«العملاء» و«العقود». استخدم قالب بيانات الفرع.");

  // الفرع المكتوب في الملف يجب أن يطابق الفرع المختار — يمنع رفع ملف فرع على فرع آخر
  const branchNames = new Set([book.units, book.tenants, book.contracts].flatMap((s) => s?.rows.map((r) => r.branch).filter((b): b is string => !!b) ?? []).map(normName));
  const foreign = [...branchNames].filter((b) => b !== normName(branch.nameAr));
  if (foreign.length) err("الملف", null, `الملف خاص بفرع «${foreign.join("، ")}» وأنت تستورد إلى فرع «${branch.nameAr}». اختر الفرع الصحيح.`);

  const [types, existingUnits, floors, tenantsAll] = await Promise.all([
    db.unitType.findMany({ where: { isActive: true } }),
    db.unit.findMany({ where: { branchId }, include: { unitType: true } }),
    db.floor.findMany({ where: { branchId } }),
    db.tenant.findMany({
      where: { archivedAt: null },
      select: {
        id: true,
        name: true,
        crNumber: true,
        vatNumber: true,
        nationalId: true,
      },
    }),
  ]);
  const typeByName = new Map(types.flatMap((t) => [[normName(t.nameAr), t] as const, [normName(t.key), t] as const]));

  // ── الوحدات ──
  const units = new Map<string, UnitPlan>();
  const S1 = SHEETS.units;
  for (const r of book.units?.rows ?? []) {
    const code = text(r.get(/^رقم الوحده/));
    if (!code) {
      err(S1, r.n, "رقم الوحدة فارغ");
      continue;
    }
    if (!/^[\p{L}\p{N}\s\-_/.]{1,30}$/u.test(code)) err(S1, r.n, `رقم الوحدة «${code}» يحتوي رموزًا غير مسموحة`);
    if (units.has(code)) {
      err(S1, r.n, `رقم الوحدة ${code} مكرر في الشيت`);
      continue;
    }
    const typeTxt = text(r.get(/^نوع الوحده/));
    const type = typeTxt ? typeByName.get(normName(typeTxt)) : undefined;
    if (!typeTxt) err(S1, r.n, `الوحدة ${code}: نوع الوحدة فارغ`);
    else if (!type) err(S1, r.n, `الوحدة ${code}: نوع غير معروف «${typeTxt}»`);
    const cap = num(r.get(/^السعه/));
    if (cap === null) err(S1, r.n, `الوحدة ${code}: السعة (عدد المقاعد) فارغة`);
    else if (cap === "bad" || !Number.isInteger(cap) || cap < 1 || cap > 1000) err(S1, r.n, `الوحدة ${code}: السعة غير صحيحة`);
    const price = num(r.get(/^السعر الاساسي/));
    if (price === null) err(S1, r.n, `الوحدة ${code}: السعر الأساسي فارغ (اكتب السعر المعروض حتى لو كانت متاحة أو غير نشطة)`);
    else if (price === "bad" || price < 0) err(S1, r.n, `الوحدة ${code}: السعر غير صحيح`);
    const cycTxt = text(r.get(/^دوره التسعير/));
    const cycle = cycTxt ? CYCLES[normName(cycTxt)] : undefined;
    if (!cycTxt) err(S1, r.n, `الوحدة ${code}: دورة التسعير فارغة`);
    else if (!cycle) err(S1, r.n, `الوحدة ${code}: دورة تسعير غير معروفة «${cycTxt}»`);
    const stTxt = text(r.get(/^الحاله/));
    const status = stTxt ? UNIT_STATUS[normName(stTxt)] : undefined;
    if (!stTxt) err(S1, r.n, `الوحدة ${code}: الحالة فارغة`);
    else if (!status) err(S1, r.n, `الوحدة ${code}: حالة غير معروفة «${stTxt}»`);
    const area = num(r.get(/^المساحه/));
    if (area === "bad" || (typeof area === "number" && area <= 0)) err(S1, r.n, `الوحدة ${code}: المساحة غير صحيحة`);
    const existing = existingUnits.find((u) => u.code === code);
    if (existing) warn(S1, r.n, `الوحدة ${code} مسجلة في الفرع مسبقًا — ستُترك كما هي`);
    units.set(code, {
      row: r.n,
      code,
      unitTypeId: type?.id ?? "",
      typeName: type?.nameAr ?? typeTxt ?? "",
      leaseMode: existing?.unitType.leaseMode ?? type?.leaseMode ?? "LEASE",
      occupancyMode: existing?.occupancyMode ?? type?.occupancyMode ?? "EXCLUSIVE",
      floor: text(r.get(/^الدور/)),
      area: typeof area === "number" ? area.toFixed(2) : null,
      capacity: existing?.capacity ?? (typeof cap === "number" ? cap : 1),
      price: typeof price === "number" ? price.toFixed(2) : "0",
      cycle: cycle ?? "MONTH",
      status: status ?? "AVAILABLE",
      rented: normName(stTxt) === "مؤجره",
      notes: text(r.get(/^ملاحظات/)),
      existingId: existing?.id ?? null,
    });
  }
  const unitByCode = (code: string) => {
    const u = units.get(code);
    if (u) return u;
    const e = existingUnits.find((x) => x.code === code);
    return e
      ? {
          code,
          existingId: e.id,
          status: e.status,
          leaseMode: e.unitType.leaseMode,
          occupancyMode: e.occupancyMode,
          capacity: e.capacity,
          price: e.basePrice.toFixed(2),
          cycle: e.pricingCycle,
          archived: !!e.archivedAt,
        }
      : null;
  };

  // ── العملاء ──
  const tenants = new Map<string, TenantPlan>();
  const S2 = SHEETS.tenants;
  const seenCr = new Map<string, string>();
  const seenVat = new Map<string, string>();
  for (const r of book.tenants?.rows ?? []) {
    const name = text(r.get(/^اسم العميل/));
    if (!name || name.length < 2) {
      err(S2, r.n, "اسم العميل فارغ");
      continue;
    }
    const key = normName(name);
    if (tenants.has(key)) {
      err(S2, r.n, `العميل «${name}» مكرر في الشيت (كل عميل مرة واحدة)`);
      continue;
    }
    const typeTxt = text(r.get(/^نوع العميل/));
    const type = typeTxt ? TENANT_TYPE[normName(typeTxt)] : undefined;
    if (!type) err(S2, r.n, `«${name}»: نوع العميل ${typeTxt ? `غير معروف «${typeTxt}»` : "فارغ"} (منشأة / فرد)`);
    const stTxt = text(r.get(/^حاله العميل/));
    const status = stTxt ? TENANT_STATUS[normName(stTxt)] : undefined;
    if (!status) err(S2, r.n, `«${name}»: حالة العميل ${stTxt ? `غير معروفة «${stTxt}»` : "فارغة"}`);
    const mobile = digitsOnly(text(r.get(/^الجوال/)));
    if (!mobile) (status === "FORMER" ? warn : err)(S2, r.n, `«${name}»: رقم الجوال فارغ`);
    else if (!/^\+?\d{9,15}$/.test(mobile)) err(S2, r.n, `«${name}»: رقم الجوال غير صحيح «${mobile}»`);
    const email = text(r.get(/^البريد/))?.toLowerCase() ?? null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(S2, r.n, `«${name}»: البريد الإلكتروني غير صحيح`);
    const cr = digitsOnly(text(r.get(/^السجل التجاري/)));
    if (cr && !/^\d{10}$/.test(cr)) err(S2, r.n, `«${name}»: السجل التجاري يجب أن يكون 10 أرقام`);
    const vat = digitsOnly(text(r.get(/^الرقم الضريبي/)));
    if (vat && !/^\d{15}$/.test(vat)) err(S2, r.n, `«${name}»: الرقم الضريبي يجب أن يكون 15 رقمًا`);
    const nid = digitsOnly(text(r.get(/^رقم الهويه/)));
    if (nid && !/^\d{10}$/.test(nid)) err(S2, r.n, `«${name}»: رقم الهوية يجب أن يكون 10 أرقام`);
    if (nid && !actor.permissions.has("tenants.view_sensitive")) err(S2, r.n, `«${name}»: لا تملك صلاحية إدخال رقم الهوية`);
    for (const [val, seen, label] of [
      [cr, seenCr, "السجل التجاري"],
      [vat, seenVat, "الرقم الضريبي"],
    ] as const) {
      if (!val) continue;
      const other = seen.get(val);
      if (other) err(S2, r.n, `${label} ${val} مكرر بين «${other}» و«${name}» — لا يتكرر لعميلين`);
      else seen.set(val, name);
    }
    const existing = tenantsAll.find((t) => normName(t.name) === key);
    if (existing) warn(S2, r.n, `العميل «${name}» مسجل في النظام مسبقًا — سيُربط بعقوده دون تعديل بياناته`);
    else
      for (const [val, field, label] of [
        [cr, "crNumber", "السجل التجاري"],
        [vat, "vatNumber", "الرقم الضريبي"],
        [nid, "nationalId", "رقم الهوية"],
      ] as const) {
        const owner = val ? tenantsAll.find((t) => t[field] === val) : undefined;
        if (owner) err(S2, r.n, `«${name}»: ${label} مسجل لعميل آخر في النظام («${owner.name}»)`);
      }
    tenants.set(key, {
      row: r.n,
      name,
      type: type ?? "COMPANY",
      contact: text(r.get(/^اسم الشخص/)),
      mobile,
      email,
      cr,
      vat,
      nationalId: nid,
      address: text(r.get(/^العنوان/)),
      status: status ?? "PROSPECT",
      notes: text(r.get(/^ملاحظات/)),
      existingId: existing?.id ?? null,
    });
  }
  const tenantByName = (name: string) => {
    const key = normName(name);
    const t = tenants.get(key);
    if (t) return { key, name: t.name, existingId: t.existingId };
    const e = tenantsAll.find((x) => normName(x.name) === key);
    return e ? { key, name: e.name, existingId: e.id } : null;
  };

  // ── العقود ──
  const S3 = SHEETS.contracts;
  const groups = new Map<string, { rows: Sheet["rows"] }>();
  let auto = 0;
  for (const r of book.contracts?.rows ?? []) {
    let ref = text(r.get(/^رقم مرجع العقد/));
    if (!ref) {
      ref = `بدون مرجع ${++auto}`;
      warn(S3, r.n, "رقم مرجع العقد فارغ — اعتُبر هذا السطر عقدًا مستقلًا");
    }
    const g = groups.get(ref) ?? { rows: [] };
    g.rows.push(r);
    groups.set(ref, g);
  }
  const contracts: ContractPlan[] = [];
  const usedUnits = new Map<string, string>();
  const vatRate = (await db.systemSetting.findUnique({ where: { key: "finance.vat_rate" } }))?.value;
  const rate = typeof vatRate === "string" || typeof vatRate === "number" ? String(vatRate) : "0.15";
  for (const [ref, g] of groups) {
    const first = g.rows[0]!;
    const rowsN = g.rows.map((r) => r.n);
    const label = ref.startsWith("بدون مرجع") ? `السطر ${first.n}` : `العقد ${ref}`;
    const clientTxt = text(first.get(/^اسم العميل/));
    const start = ymd(first.get(/^تاريخ بدايه/));
    const months = num(first.get(/^مده العقد/));
    const cycTxt = text(first.get(/^دوره الدفع/));
    const cycle = cycTxt ? BILLING[normName(cycTxt)] : undefined;
    let ok = true;
    const fail = (row: number, message: string) => {
      ok = false;
      err(S3, row, message);
    };
    const tenant = clientTxt ? tenantByName(clientTxt) : null;
    if (!clientTxt) fail(first.n, `${label}: اسم العميل فارغ`);
    else if (!tenant) fail(first.n, `${label}: العميل «${clientTxt}» غير موجود في شيت العملاء — اكتب الاسم مطابقًا تمامًا`);
    else if (tenant.name !== clientTxt) warn(S3, first.n, `${label}: «${clientTxt}» اعتُبر نفسه العميل «${tenant.name}» (اختلاف كتابة بسيط)`);
    if (start === null) fail(first.n, `${label}: تاريخ بداية العقد فارغ`);
    else if (start === "bad") fail(first.n, `${label}: تاريخ البداية غير صحيح (اكتبه بصيغة يوم/شهر/سنة)`);
    if (months === null) fail(first.n, `${label}: مدة العقد (بالأشهر) فارغة`);
    else if (months === "bad" || !Number.isInteger(months) || months < 1 || months > 60) fail(first.n, `${label}: مدة العقد يجب أن تكون عددًا صحيحًا من 1 إلى 60 شهرًا`);
    if (!cycTxt) fail(first.n, `${label}: دورة الدفع فارغة`);
    else if (!cycle) fail(first.n, `${label}: دورة دفع غير معروفة «${cycTxt}»`);
    for (const r of g.rows.slice(1)) {
      const c2 = text(r.get(/^اسم العميل/));
      const s2 = ymd(r.get(/^تاريخ بدايه/));
      const m2 = num(r.get(/^مده العقد/));
      if ((c2 && normName(c2) !== normName(clientTxt)) || (s2 && s2 !== start) || (m2 !== null && m2 !== months))
        fail(r.n, `${label}: سطور العقد الواحد يجب أن يكون لها نفس العميل وتاريخ البداية والمدة`);
    }
    const lines: ContractPlan["lines"] = [];
    for (const r of g.rows) {
      const code = text(r.get(/^رقم الوحده/));
      const monthly = num(r.get(/^الايجار الشهري/));
      if (!code) {
        fail(r.n, `${label}: رقم الوحدة فارغ`);
        continue;
      }
      const u = unitByCode(code);
      if (!u) fail(r.n, `${label}: الوحدة ${code} غير موجودة في شيت الوحدات ولا في النظام`);
      else if (u.status === "INACTIVE") fail(r.n, `${label}: الوحدة ${code} حالتها «غير نشطة» ولا يمكن تأجيرها`);
      else if (u.leaseMode !== "LEASE") fail(r.n, `${label}: الوحدة ${code} تُدار بالحجوزات وليس بالعقود`);
      if (monthly === null) fail(r.n, `${label}: الإيجار الشهري للوحدة ${code} فارغ`);
      else if (monthly === "bad" || monthly <= 0) fail(r.n, `${label}: الإيجار الشهري للوحدة ${code} غير صحيح`);
      const prev = usedUnits.get(code);
      if (prev) fail(r.n, `الوحدة ${code} مكررة في أكثر من عقد (${prev} و${label}) — عقد واحد ساري لكل مكتب`);
      usedUnits.set(code, label);
      if (u && typeof monthly === "number" && u.cycle === "MONTH" && Math.abs(Number(u.price) - monthly) > 0.009)
        warn(S3, r.n, `${label}: إيجار الوحدة ${code} في العقد ${monthly} ر.س بينما سعرها في شيت الوحدات ${Number(u.price)} ر.س — يُعتمد مبلغ العقد`);
      const seatsN = num(r.get(/^عدد المقاعد/));
      const shared = u?.occupancyMode === "SHARED";
      const seats = shared ? (typeof seatsN === "number" && Number.isInteger(seatsN) && seatsN >= 1 ? seatsN : 0) : (u?.capacity ?? 1);
      if (shared && !seats) fail(r.n, `${label}: الوحدة ${code} مشتركة — اكتب عدد المقاعد`);
      if (shared && u && seats > u.capacity) fail(r.n, `${label}: المقاعد في ${code} أكثر من سعتها (${u.capacity})`);
      lines.push({
        unitCode: code,
        seats: seats || 1,
        monthly: typeof monthly === "number" ? monthly.toFixed(2) : "0",
      });
    }
    let calc: ReturnType<typeof computeContract> | null = null;
    if (ok && typeof start === "string" && typeof months === "number" && cycle) {
      try {
        calc = computeContract({
          startDate: start,
          durationMonths: months,
          billingCycle: cycle,
          monthlyPrices: lines.map((l) => l.monthly),
          discount: "0",
          vatRate: rate,
        });
      } catch (e) {
        err(S3, first.n, `${label}: ${toSafeMessage(e)}`);
      }
      if (calc && calc.endDate < today) warn(S3, first.n, `${label}: انتهى في ${calc.endDate} — سيُسجل ثم يُغلق تلقائيًا كعقد منتهٍ`);
      if (start && typeof start === "string" && start > today) warn(S3, first.n, `${label}: يبدأ مستقبلًا (${start})`);
    }
    contracts.push({
      ref,
      rows: rowsN,
      paperNo: text(first.get(/^رقم العقد الورقي/)),
      tenantKey: tenant?.key ?? "",
      tenantName: tenant?.name ?? clientTxt ?? "",
      start: typeof start === "string" ? start : "",
      end: calc?.endDate ?? "",
      months: typeof months === "number" ? months : 0,
      cycle: cycle ?? "MONTHLY",
      lines,
      notes: text(first.get(/^ملاحظات/)),
      total: calc?.total ?? new Prisma.Decimal(0),
      installments:
        calc?.installments.map((i) => ({
          seqNo: i.seqNo,
          dueDate: i.dueDate,
          amountDue: i.amountDue,
        })) ?? [],
      paid: new Prisma.Decimal(0),
      paidOn: null,
      existing: false,
    });
  }

  // العقود القائمة في النظام لنفس الوحدات: نفس العميل ⇐ تُتجاوز (إعادة رفع)، عميل آخر ⇐ تعارض
  const codesInContracts = contracts.flatMap((c) => c.lines.map((l) => l.unitCode));
  const unitIds = codesInContracts.map((c) => unitByCode(c)?.existingId).filter((x): x is string => !!x);
  if (unitIds.length) {
    const live = await db.contractUnit.findMany({
      where: {
        unitId: { in: unitIds },
        blocksOccupancy: true,
        contract: { status: { in: ["PENDING_APPROVAL", "ACTIVE"] } },
      },
      include: {
        unit: { select: { code: true } },
        contract: {
          select: { contractNo: true, tenant: { select: { name: true } } },
        },
      },
    });
    for (const c of contracts) {
      for (const l of c.lines) {
        const hit = live.find((x) => x.unit.code === l.unitCode && (!c.start || (x.startDate.toISOString().slice(0, 10) <= (c.end || c.start) && x.endDate.toISOString().slice(0, 10) >= c.start)));
        if (!hit) continue;
        if (normName(hit.contract.tenant.name) === c.tenantKey) {
          c.existing = true;
          warn(S3, c.rows[0]!, `الوحدة ${l.unitCode} عليها عقد مسجل مسبقًا (${hit.contract.contractNo}) لنفس العميل — سيُتجاوز`);
        } else err(S3, c.rows[0]!, `الوحدة ${l.unitCode} مؤجرة في النظام للعميل «${hit.contract.tenant.name}» بالعقد ${hit.contract.contractNo}`);
      }
    }
  }

  // الوحدات «مؤجرة» بلا عقد في الملف
  for (const u of units.values()) {
    if (u.rented && !usedUnits.has(u.code)) warn(S1, u.row, `الوحدة ${u.code} حالتها «مؤجرة» ولا يوجد لها عقد في شيت العقود — ستظهر متاحة حتى يُسجل عقدها`);
  }

  // ── السداد ──
  const S4 = SHEETS.payments;
  const paidRefs = new Set<string>();
  for (const r of book.payments?.rows ?? []) {
    const ref = text(r.get(/^رقم مرجع العقد/));
    const paid = num(r.get(/^اجمالي المسدد/));
    if (!ref) {
      if (paid !== null) err(S4, r.n, "رقم مرجع العقد فارغ");
      continue;
    }
    const c = contracts.find((x) => x.ref === ref);
    if (!c) {
      err(S4, r.n, `لا يوجد عقد بالمرجع ${ref} في شيت العقود`);
      continue;
    }
    if (paidRefs.has(ref)) {
      err(S4, r.n, `العقد ${ref} له أكثر من سطر سداد`);
      continue;
    }
    paidRefs.add(ref);
    if (paid === null) err(S4, r.n, `العقد ${ref}: إجمالي المسدد فارغ (اكتب 0 إن لم يدفع)`);
    else if (paid === "bad" || paid < 0) err(S4, r.n, `العقد ${ref}: المبلغ المسدد غير صحيح`);
    else if (c.installments.length && money(paid).gt(c.total)) err(S4, r.n, `العقد ${ref}: المسدد (${paid}) أكبر من إجمالي العقد (${c.total.toFixed(2)})`);
    else {
      c.paid = money(paid);
      const last = ymd(r.get(/^اخر قسط/));
      c.paidOn = typeof last === "string" && last <= today ? last : null;
      const overdue = num(r.get(/^المتاخر/));
      if (typeof overdue === "number" && c.installments.length) {
        const dueSoFar = c.installments.filter((i) => i.dueDate <= today).reduce((a, i) => a.plus(i.amountDue), new Prisma.Decimal(0));
        const computed = Prisma.Decimal.max(0, dueSoFar.minus(c.paid));
        if (computed.minus(overdue).abs().gt(1)) warn(S4, r.n, `العقد ${ref}: المتأخر المكتوب ${overdue} ر.س، وحسب الأقساط والمسدد يكون ${computed.toFixed(2)} ر.س`);
      }
    }
  }
  for (const c of contracts)
    if (!paidRefs.has(c.ref) && !c.existing && c.installments.length)
      warn(S3, c.rows[0]!, `${c.ref.startsWith("بدون مرجع") ? `السطر ${c.rows[0]}` : `العقد ${c.ref}`}: لا يوجد له سطر في شيت السداد — سيُعتبر غير مسدد`);

  // الأدوار الجديدة
  const floorNames = new Set(floors.map((f) => normName(f.name)));
  const newFloors = [...new Set([...units.values()].filter((u) => !u.existingId && u.floor && !floorNames.has(normName(u.floor))).map((u) => u.floor!))].filter(
    (f, i, a) => a.findIndex((x) => normName(x) === normName(f)) === i,
  );

  return { branch, units, tenants, contracts, issues, floors, newFloors };
}

function toPreview(a: Awaited<ReturnType<typeof analyze>>): ImportPreview {
  const cyc = {
    MONTH: "شهري",
    YEAR: "سنوي",
    DAY: "يومي",
    HOUR: "بالساعة",
  } as const;
  const st = {
    AVAILABLE: "متاحة",
    RESERVED: "محجوزة",
    RENTED: "مؤجرة",
    MAINTENANCE: "صيانة",
    INACTIVE: "غير نشطة",
  } as const;
  const tst = { ACTIVE: "نشط", FORMER: "سابق", PROSPECT: "محتمل" } as const;
  const sorted = [...a.issues].sort((x, y) => (x.level === y.level ? 0 : x.level === "error" ? -1 : 1));
  return {
    branch: { id: a.branch.id, name: a.branch.nameAr, code: a.branch.code },
    units: [...a.units.values()].map((u) => ({
      row: u.row,
      code: u.code,
      type: u.typeName,
      floor: u.floor,
      capacity: u.capacity,
      price: u.price,
      cycle: cyc[u.cycle],
      status: u.rented ? "مؤجرة" : st[u.status],
      action: u.existingId ? "exists" : "create",
    })),
    floors: a.newFloors,
    tenants: [...a.tenants.values()].map((t) => ({
      row: t.row,
      name: t.name,
      type: t.type === "COMPANY" ? "منشأة" : "فرد",
      mobile: t.mobile,
      status: tst[t.status],
      action: t.existingId ? "exists" : "create",
    })),
    contracts: a.contracts.map((c) => ({
      ref: c.ref,
      rows: c.rows,
      tenant: c.tenantName,
      units: c.lines.map((l) => l.unitCode),
      start: c.start || null,
      end: c.end || null,
      months: c.months || null,
      cycle: c.installments.length ? BILLING_AR[c.cycle] : null,
      monthly: c.lines.reduce((s, l) => s.plus(l.monthly), new Prisma.Decimal(0)).toFixed(2),
      total: c.installments.length ? c.total.toFixed(2) : null,
      paid: c.paid.toFixed(2),
      installments: c.installments.length,
      action: c.existing ? "exists" : "create",
    })),
    issues: sorted,
    errors: a.issues.filter((i) => i.level === "error").length,
    warnings: a.issues.filter((i) => i.level === "warning").length,
  };
}

/** معاينة بلا كتابة */
export async function previewBranchImport(db: Db, actor: Actor, branchId: string, bytes: Uint8Array) {
  return toPreview(await analyze(db, actor, branchId, bytes));
}

export type ImportResult = {
  units: number;
  floors: number;
  tenants: number;
  contracts: number;
  payments: number;
  failed: { ref: string; message: string }[];
};

/** التنفيذ: يعيد التحقق ويرفض عند وجود أخطاء. الوحدات والعملاء في معاملة واحدة، ثم كل عقد بمساره المعتاد. */
export async function commitBranchImport(db: Db, actor: Actor, branchId: string, bytes: Uint8Array, meta: RequestMeta = {}): Promise<ImportResult> {
  const a = await analyze(db, actor, branchId, bytes);
  const errors = a.issues.filter((i) => i.level === "error").length;
  if (errors) throw new AppError("VALIDATION", `في الملف ${errors} خطأ — صححها وأعد المعاينة قبل الاستيراد`);
  const source = { source: "excel_import" };

  const base = await db.$transaction(async (tx) => {
    const floorIds = new Map(a.floors.map((f) => [normName(f.name), f.id]));
    let level = a.floors.reduce((m, f) => Math.max(m, f.level), 0);
    for (const name of a.newFloors) {
      const f = await tx.floor.create({
        data: { branchId, name, level: ++level },
      });
      floorIds.set(normName(name), f.id);
      await writeAudit(tx, {
        actorId: actor.id,
        action: "floor.create",
        entityType: "floor",
        entityId: f.id,
        branchId,
        after: { name, ...source },
        meta,
      });
    }
    let unitsN = 0;
    for (const u of a.units.values()) {
      if (u.existingId) continue;
      const created = await tx.unit.create({
        data: {
          branchId,
          floorId: u.floor ? (floorIds.get(normName(u.floor)) ?? null) : null,
          unitTypeId: u.unitTypeId,
          code: u.code,
          occupancyMode: u.occupancyMode as "EXCLUSIVE" | "SHARED",
          areaSqm: u.area,
          capacity: u.capacity,
          basePrice: u.price,
          pricingCycle: u.cycle,
          status: u.status,
          description: u.notes,
        },
      });
      unitsN++;
      await writeAudit(tx, {
        actorId: actor.id,
        action: "unit.create",
        entityType: "unit",
        entityId: created.id,
        branchId,
        after: {
          code: u.code,
          basePrice: u.price,
          capacity: u.capacity,
          status: u.status,
          ...source,
        },
        meta,
      });
    }
    let tenantsN = 0;
    const tenantIds = new Map<string, string>();
    for (const [key, t] of a.tenants) {
      if (t.existingId) {
        tenantIds.set(key, t.existingId);
        continue;
      }
      const created = await tx.tenant.create({
        data: {
          type: t.type,
          name: t.name,
          contactPersonName: t.contact,
          mobile: t.mobile,
          email: t.email,
          crNumber: t.cr,
          vatNumber: t.vat,
          nationalId: t.nationalId,
          nationalAddress: t.address,
          primaryBranchId: branchId,
          status: t.status,
          notes: t.notes,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      tenantIds.set(key, created.id);
      tenantsN++;
      await writeAudit(tx, {
        actorId: actor.id,
        action: "tenant.create",
        entityType: "tenant",
        entityId: created.id,
        branchId,
        after: { name: t.name, type: t.type, ...source },
        meta,
      });
    }
    return { unitsN, tenantsN, floorsN: a.newFloors.length, tenantIds };
  });

  // معرفات الوحدات بعد الإنشاء
  const unitRows = await db.unit.findMany({
    where: { branchId },
    select: { id: true, code: true },
  });
  const unitId = new Map(unitRows.map((u) => [u.code, u.id]));
  const tenantId = (key: string) => base.tenantIds.get(key) ?? null;
  const allTenants = await db.tenant.findMany({
    where: { archivedAt: null },
    select: { id: true, name: true },
  });

  let contractsN = 0;
  let paymentsN = 0;
  const failed: ImportResult["failed"] = [];
  for (const c of a.contracts) {
    if (c.existing) continue;
    try {
      const tid = tenantId(c.tenantKey) ?? allTenants.find((t) => normName(t.name) === c.tenantKey)?.id;
      if (!tid) throw new AppError("VALIDATION", "العميل غير موجود");
      const notes = [`مستورد من ملف بيانات الفرع — مرجع ${c.ref}`, c.paperNo ? `رقم العقد الورقي: ${c.paperNo}` : null, c.notes].filter(Boolean).join("\n");
      const draft = await createContract(
        db,
        actor,
        {
          tenantId: tid,
          branchId,
          startDate: c.start,
          durationMonths: c.months,
          billingCycle: c.cycle,
          units: c.lines.map((l) => ({
            unitId: unitId.get(l.unitCode),
            seats: l.seats,
            monthlyPrice: l.monthly,
          })),
          discountAmount: "0",
          notes,
        },
        meta,
      );
      await submitForApproval(db, actor, draft.id, meta);
      await approveContract(db, actor, draft.id, meta);
      contractsN++;
      if (c.paid.gt(0)) {
        const schedules = await db.paymentSchedule.findMany({
          where: { contractId: draft.id },
          orderBy: { seqNo: "asc" },
        });
        let left = c.paid;
        const allocations: { scheduleId: string; amount: string }[] = [];
        for (const s of schedules) {
          if (left.lte(0)) break;
          const amt = Prisma.Decimal.min(left, s.amountDue);
          allocations.push({ scheduleId: s.id, amount: amt.toFixed(2) });
          left = left.minus(amt);
        }
        const p = await recordPayment(
          db,
          actor,
          {
            contractId: draft.id,
            amount: c.paid.toFixed(2),
            method: "OTHER",
            paidOn: c.paidOn ?? todayInRiyadh(),
            notes: "رصيد افتتاحي: المسدد قبل تشغيل النظام (من ملف بيانات الفرع)",
            idempotencyKey: randomUUID(),
            allocations,
          },
          meta,
        );
        if (p) await approvePayment(db, actor, p.id, meta);
        paymentsN++;
      }
    } catch (e) {
      failed.push({ ref: c.ref, message: toSafeMessage(e) });
    }
  }

  await writeAudit(db, {
    actorId: actor.id,
    action: "branch.import",
    entityType: "branch",
    entityId: branchId,
    branchId,
    after: {
      units: base.unitsN,
      floors: base.floorsN,
      tenants: base.tenantsN,
      contracts: contractsN,
      payments: paymentsN,
      failed: failed.length,
    },
    meta,
  });
  return {
    units: base.unitsN,
    floors: base.floorsN,
    tenants: base.tenantsN,
    contracts: contractsN,
    payments: paymentsN,
    failed,
  };
}
