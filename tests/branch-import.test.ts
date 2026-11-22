import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import { prisma, makeActor } from "./helpers";
import { commitBranchImport, normName, previewBranchImport } from "@/services/branch-import.service";
import { addDays, todayInRiyadh } from "@/lib/dates";
import { buildSimpleTemplate } from "@/lib/import-template";

const TODAY = todayInRiyadh();
const START = addDays(TODAY, -40);

const H = {
  units: [
    "الفرع (تلقائي)",
    "رقم الوحدة / المكتب *",
    "نوع الوحدة *",
    "الدور",
    "المساحة م²",
    "السعة (عدد المقاعد) *",
    "السعر الأساسي شامل الضريبة (ر.س) *",
    "دورة التسعير *",
    "الحالة الحالية *",
    "السعر قبل الضريبة (تلقائي)",
    "ملاحظات",
  ],
  tenants: [
    "اسم العميل / المنشأة *",
    "نوع العميل *",
    "الفرع الأساسي (تلقائي)",
    "اسم الشخص المسؤول",
    "الجوال *",
    "البريد الإلكتروني",
    "السجل التجاري",
    "الرقم الضريبي",
    "رقم الهوية (اختياري)",
    "العنوان الوطني",
    "حالة العميل *",
    "ملاحظات",
  ],
  contracts: [
    "رقم مرجع العقد *",
    "رقم العقد الورقي (إن وجد)",
    "اسم العميل *",
    "الفرع (تلقائي)",
    "رقم الوحدة *",
    "عدد المقاعد",
    "الإيجار الشهري للوحدة شامل الضريبة (ر.س) *",
    "تاريخ بداية العقد *",
    "مدة العقد (بالأشهر) *",
    "تاريخ النهاية (تلقائي)",
    "دورة الدفع *",
    "قيمة القسط (تلقائي)",
    "إجمالي قيمة الوحدة في العقد (تلقائي)",
    "ملاحظات (شروط خاصة)",
  ],
  payments: [
    "رقم مرجع العقد *",
    "اسم العميل (تلقائي)",
    "إجمالي قيمة العقد (تلقائي)",
    "إجمالي المسدد حتى اليوم (ر.س) *",
    "المتبقي من العقد (تلقائي)",
    "آخر قسط تم سداده (تاريخ استحقاقه)",
    "المتأخر حاليًا (ر.س)",
    "ملاحظات",
  ],
};

type Rows = {
  units?: unknown[][];
  tenants?: unknown[][];
  contracts?: unknown[][];
  payments?: unknown[][];
};
async function book(rows: Rows) {
  const wb = new ExcelJS.Workbook();
  const names = {
    units: "الوحدات",
    tenants: "العملاء",
    contracts: "العقود",
    payments: "السداد",
  } as const;
  for (const k of Object.keys(names) as (keyof typeof names)[]) {
    const ws = wb.addWorksheet(names[k]);
    ws.addRow(["عنوان"]);
    ws.addRow(["شرح"]);
    ws.addRow(H[k]);
    // صف المثال الرمادي — لا يُستورد
    if (k === "units") ws.addRow(["x", "101", "مكتب خاص", "الثاني", 20, 4, 3450, "شهري", "مؤجرة", 3000, "مطل على الشارع"]);
    if (k === "tenants") ws.addRow(["شركة المثال للتقنية", "منشأة", "x", "أحمد", "0551234567"]);
    if (k === "contracts") ws.addRow([1, null, "شركة المثال للتقنية", "x", "101", null, 3450, new Date(Date.UTC(2026, 0, 1)), 12, null, "ربع سنوي"]);
    for (const r of rows[k] ?? []) ws.addRow(r);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function setup() {
  const code = `I${randomUUID()
    .slice(0, 4)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "Y")}`;
  const branch = await prisma.branch.create({
    data: { code, nameAr: `فرع استيراد ${randomUUID().slice(0, 6)}` },
  });
  const { actor } = await makeActor("SUPER_ADMIN");
  const { actor: staff } = await makeActor("SALES_EMPLOYEE", {
    branchCodes: [code],
  });
  return { branch, actor, staff };
}

const cr = () => String(Math.floor(1e9 + Math.random() * 8.9e9));

describe("استيراد بيانات الفرع من Excel", () => {
  it("توحيد الكتابة العربية للمطابقة", () => {
    expect(normName("  شركة  ايليت تيكنيكال ")).toBe(normName("شركه ايليت تيكنيكال"));
    expect(normName("مؤسسة إبراهيم")).toBe(normName("مؤسسه ابراهيم"));
  });

  it("المعاينة تكشف الأخطاء ولا تكتب شيئًا، والتنفيذ يُرفض عند وجودها", async () => {
    const { branch, actor } = await setup();
    const n = branch.nameAr;
    const dupCr = cr();
    const bytes = await book({
      units: [
        [n, "1", "مكتب خاص", "الثاني", 7.5, 2, 1725, "شهري", "مؤجرة"],
        [n, "1", "مكتب خاص", "الثاني", 7.5, 2, 1725, "شهري", "مؤجرة"], // مكرر
        [n, "2", "مكتب خاص", "الثاني", 7.5, null, null, null, "متاحة"], // ناقص سعة وسعر ودورة
        [n, "3", "مكتب سحري", "الثاني", 7.5, 2, 1000, "شهري", "متاحة"], // نوع غير معروف
      ],
      tenants: [
        ["شركة أ", "منشأة", n, null, "0500000001", null, dupCr, null, null, null, "نشط"],
        ["شركة ب", "منشأة", n, null, "0500000002", null, dupCr, null, null, null, "نشط"], // سجل مكرر
        ["شركة ج", "منشأة", n, null, null, null, null, null, null, null, "نشط"], // بلا جوال
      ],
      contracts: [
        [null, null, "شركة أ", n, "1", null, 1725, null, null, null, null], // بلا تاريخ ومدة ودورة
        ["7", null, "عميل غير موجود", n, "1", null, 1725, START, 6, null, "شهري"],
      ],
      payments: [["99", null, null, 100]],
    });
    const p = await previewBranchImport(prisma, actor, branch.id, bytes);
    const msgs = p.issues
      .filter((i) => i.level === "error")
      .map((i) => i.message)
      .join("\n");
    expect(msgs).toContain("مكرر في الشيت");
    expect(msgs).toContain("السعة (عدد المقاعد) فارغة");
    expect(msgs).toContain("السعر الأساسي فارغ");
    expect(msgs).toContain("نوع غير معروف");
    expect(msgs).toMatch(/السجل التجاري .* مكرر/);
    expect(msgs).toContain("رقم الجوال فارغ");
    expect(msgs).toContain("تاريخ بداية العقد فارغ");
    expect(msgs).toContain("غير موجود في شيت العملاء");
    expect(msgs).toContain("مكررة في أكثر من عقد");
    expect(msgs).toContain("لا يوجد عقد بالمرجع 99");
    expect(p.units.some((u) => u.code === "101")).toBe(false); // صف المثال لا يُستورد
    expect(await prisma.unit.count({ where: { branchId: branch.id } })).toBe(0);
    await expect(commitBranchImport(prisma, actor, branch.id, bytes)).rejects.toThrow(/خطأ/);
    expect(await prisma.unit.count({ where: { branchId: branch.id } })).toBe(0);
  });

  it("ملف فرع آخر يُرفض", async () => {
    const { branch, actor } = await setup();
    const bytes = await book({
      units: [["فرع غريب", "1", "مكتب خاص", null, null, 2, 1000, "شهري", "متاحة"]],
    });
    const p = await previewBranchImport(prisma, actor, branch.id, bytes);
    expect(p.issues.some((i) => i.level === "error" && i.message.includes("الملف خاص بفرع"))).toBe(true);
  });

  it("يستورد الوحدات والعملاء والعقود والمسدد، وإعادة الرفع لا تكرر شيئًا", async () => {
    const { branch, actor } = await setup();
    const n = branch.nameAr;
    const bytes = await book({
      units: [
        [n, "1", "مكتب خاص", "الثاني ", 7.5, 2, 1725, "شهري", "مؤجرة"],
        [n, "2", "مكتب خاص", "الثاني", 7.5, 2, 1725, "شهري", "مؤجرة"],
        [n, "3", "مكتب خاص", "الثالث", 7.5, 2, 1500, "شهري", "متاحة"],
        [n, "9", "مكتب خاص", "الثالث", 18, 1, 0, "شهري", "غير نشطة", null, "غير مؤثث"],
      ],
      tenants: [
        ["شركة الوئام", "منشأة", n, "حسن", "0556000001", "a@b.sa", cr(), null, null, "تبوك", "نشط"],
        ["مرام", "فرد", n, "مرام", "0552000002", null, null, null, null, null, "نشط"],
      ],
      contracts: [
        [1, "2015", "شركه الوئام", n, "1", null, 1725, START, 12, null, "ربع سنوي"],
        [1, "2015", "شركة الوئام", n, "2", null, 1725, START, 12, null, "ربع سنوي"],
        [2, null, "مرام", n, "3", null, 1500, START, 6, null, "شهري"],
      ],
      payments: [
        [1, null, null, 10350, null, null, 0],
        [2, null, null, 1500],
      ],
    });
    const p = await previewBranchImport(prisma, actor, branch.id, bytes);
    expect(p.errors).toBe(0);
    expect(p.floors.sort()).toEqual(["الثالث", "الثاني"]);
    expect(p.contracts).toHaveLength(2);
    expect(p.contracts[0]!.total).toBe("41400.00"); // 2 × 1725 × 12
    expect(p.contracts[0]!.installments).toBe(4);

    const r = await commitBranchImport(prisma, actor, branch.id, bytes);
    expect(r).toMatchObject({
      units: 4,
      floors: 2,
      tenants: 2,
      contracts: 2,
      payments: 2,
      failed: [],
    });
    const contracts = await prisma.contract.findMany({
      where: { branchId: branch.id },
      include: { schedules: true, units: true },
    });
    expect(contracts.every((c) => c.status === "ACTIVE")).toBe(true);
    const big = contracts.find((c) => c.units.length === 2)!;
    expect(big.notes).toContain("رقم العقد الورقي: 2015");
    const paid = big.schedules.reduce((a, s) => a + Number(s.amountPaid), 0);
    expect(paid).toBe(10350);
    expect(big.schedules.find((s) => s.seqNo === 1)!.status).toBe("PAID");
    const pays = await prisma.payment.findMany({
      where: { branchId: branch.id },
    });
    expect(pays.every((x) => x.status === "APPROVED" && x.receiptNo)).toBe(true);
    const u9 = await prisma.unit.findFirstOrThrow({
      where: { branchId: branch.id, code: "9" },
    });
    expect(u9.status).toBe("INACTIVE");
    expect(
      await prisma.auditLog.count({
        where: { action: "branch.import", entityId: branch.id },
      }),
    ).toBe(1);

    // إعادة رفع نفس الملف: لا شيء جديد
    const again = await previewBranchImport(prisma, actor, branch.id, bytes);
    expect(again.errors).toBe(0);
    expect(again.units.every((u) => u.action === "exists")).toBe(true);
    expect(again.contracts.every((c) => c.action === "exists")).toBe(true);
    const r2 = await commitBranchImport(prisma, actor, branch.id, bytes);
    expect(r2).toMatchObject({
      units: 0,
      tenants: 0,
      contracts: 0,
      payments: 0,
    });
    expect(await prisma.contract.count({ where: { branchId: branch.id } })).toBe(2);
  });

  it("استيراد السليم فقط ثم إكمال الناقص بعد تصحيح الملف", async () => {
    const { branch, actor } = await setup();
    const n = branch.nameAr;
    const dup = cr();
    const rows = (fixed: boolean): Rows => ({
      units: [
        [n, "1", "مكتب خاص", "الثاني", 7.5, 2, 1725, "شهري", "مؤجرة"],
        [n, "2", "مكتب خاص", "الثاني", 7.5, fixed ? 2 : null, 1725, "شهري", "مؤجرة"], // ناقص السعة
        [n, "3", "مكتب خاص", "الثاني", 7.5, 2, 1500, "شهري", "متاحة"],
      ],
      tenants: [
        ["عميل سليم", "منشأة", n, null, "0500000011", null, null, null, null, null, "نشط"],
        ["عميل أ", "منشأة", n, null, "0500000012", null, dup, null, null, null, "نشط"],
        ["عميل ب", "منشأة", n, null, "0500000013", null, fixed ? cr() : dup, null, null, null, "نشط"], // سجل مكرر
        ["عميل بلا جوال", "فرد", n, null, fixed ? "0500000014" : null, null, null, null, null, null, "نشط"],
      ],
      contracts: [
        [1, null, "عميل سليم", n, "1", null, 1725, START, 6, null, "شهري"],
        [2, null, "عميل أ", n, "2", null, 1725, START, 6, null, "شهري"], // وحدته وعميله فيهما أخطاء
        [3, null, "عميل بلا جوال", n, "3", null, 1500, fixed ? START : null, 6, null, "شهري"], // بلا تاريخ
      ],
      payments: [[1, null, null, 1725], [2, null, null, 0], [3, null, null, 0]],
    });
    const first = await book(rows(false));
    const p = await previewBranchImport(prisma, actor, branch.id, first);
    expect(p.errors).toBeGreaterThan(0);
    expect(p.blocking).toBe(0);
    expect(p.ready).toEqual({ units: 2, tenants: 1, contracts: 1 });
    expect(p.contracts.map((c) => c.action)).toEqual(["create", "skip", "skip"]);
    await expect(commitBranchImport(prisma, actor, branch.id, first)).rejects.toThrow(/استيراد السليم فقط/);
    const r1 = await commitBranchImport(prisma, actor, branch.id, first, {}, { partial: true });
    expect(r1).toMatchObject({ units: 2, tenants: 1, contracts: 1, payments: 1, failed: [] });
    expect((await prisma.unit.findMany({ where: { branchId: branch.id } })).map((u) => u.code).sort()).toEqual(["1", "3"]);

    // بعد التصحيح: يُضاف الناقص فقط
    const second = await book(rows(true));
    const p2 = await previewBranchImport(prisma, actor, branch.id, second);
    expect(p2.errors).toBe(0);
    expect(p2.ready).toEqual({ units: 1, tenants: 3, contracts: 2 });
    const r2 = await commitBranchImport(prisma, actor, branch.id, second);
    expect(r2).toMatchObject({ units: 1, tenants: 3, contracts: 2, failed: [] });
    expect(await prisma.contract.count({ where: { branchId: branch.id, status: "ACTIVE" } })).toBe(3);
    expect(await prisma.payment.count({ where: { branchId: branch.id } })).toBe(1);
  });

  it("ملف فرع آخر لا يُستورد حتى جزئيًا", async () => {
    const { branch, actor } = await setup();
    const bytes = await book({ units: [["فرع غريب", "1", "مكتب خاص", null, null, 2, 1000, "شهري", "متاحة"]] });
    await expect(commitBranchImport(prisma, actor, branch.id, bytes, {}, { partial: true })).rejects.toThrow(/الملف خاص بفرع/);
  });

  it("الشيت المبسّط: سطر لكل مكتب يُحوَّل لوحدات وعملاء وعقود ومدفوعات", async () => {
    const { branch, actor } = await setup();
    const d = new Date(`${START}T00:00:00Z`);
    const bytes = new Uint8Array(
      await buildSimpleTemplate(branch.nameAr, [
        { code: "1", type: "مكتب خاص", floor: "الأول", capacity: 2, price: 1725, status: "مؤجرة", client: "شركة النخبة", mobile: "0551110001", start: d, months: 12, cycle: "ربع سنوي", paid: 5175 },
        { code: "2", type: "مكتب خاص", floor: "الأول", capacity: 2, price: 1725, status: "مؤجرة", client: "شركه النخبة", mobile: "0551110001", start: d, months: 12, cycle: "ربع سنوي", paid: 5175 },
        { code: "3", type: "مكتب خاص", capacity: 1, price: 1500, status: "متاحة" },
        { code: "4", type: "مكتب خاص", capacity: 1, price: 1500, status: "مؤجرة", client: "مرام", clientType: "فرد", mobile: "0552220002", start: d, months: 6, cycle: "شهري" },
        { code: "5", type: "مكتب خاص", capacity: 1, price: 1500, status: "مؤجرة", client: "بلا تاريخ", mobile: "0553330003" },
      ]),
    );
    const p = await previewBranchImport(prisma, actor, branch.id, bytes);
    expect(p.units.map((u) => u.code)).toEqual(["1", "2", "3", "4", "5"]);
    expect(p.tenants.map((t) => t.name)).toEqual(["شركة النخبة", "مرام", "بلا تاريخ"]);
    const big = p.contracts.find((c) => c.units.length === 2)!;
    expect(big).toMatchObject({ ref: "مكتب 1", total: "41400.00", paid: "10350.00", action: "create" });
    expect(p.issues.some((i) => i.level === "error" && i.sheet === "المكاتب" && i.message.includes("تاريخ بداية العقد فارغ"))).toBe(true);
    expect(p.issues.some((i) => i.message.includes("المدفوع حتى اليوم"))).toBe(true);
    expect(p.ready).toEqual({ units: 5, tenants: 2, contracts: 2 });
    const r = await commitBranchImport(prisma, actor, branch.id, bytes, {}, { partial: true });
    expect(r).toMatchObject({ units: 5, tenants: 2, contracts: 2, payments: 1, failed: [] });
    // ملف فرع آخر مرفوض حتى في الشيت المبسّط
    const other = new Uint8Array(await buildSimpleTemplate("فرع غريب", [{ code: "9", type: "مكتب خاص", capacity: 1, price: 1, status: "متاحة" }]));
    expect((await previewBranchImport(prisma, actor, branch.id, other)).blocking).toBe(1);
  });

  it("يتطلب صلاحيات الإدارة الكاملة", async () => {
    const { branch, staff } = await setup();
    await expect(previewBranchImport(prisma, staff, branch.id, await book({}))).rejects.toThrow();
  });
});
