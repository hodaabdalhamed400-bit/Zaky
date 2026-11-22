import ExcelJS from "exceljs";

/**
 * الشيت المبسّط لبيانات الفرع: سطر واحد لكل مكتب (المكتب + العميل + العقد + المدفوع).
 * قوائم منسدلة لكل اختيار، وخانات التاريخ والأرقام محمية من الكتابة الخاطئة، والصف الرمادي مثال لا يُستورد.
 * يمكن تمرير صفوف جاهزة (prefill) فتُلوَّن الخانات الناقصة المطلوبة بالأحمر الفاتح ليكمّلها الموظف فقط.
 */
export type SimpleRow = Partial<Record<(typeof COLUMNS)[number]["key"], string | number | Date | null>>;

const TYPES = ["مكتب خاص", "مكتب مشترك", "قاعة اجتماعات", "مساحة إدارية"];
const STATUSES = ["متاحة", "مؤجرة", "محجوزة", "صيانة", "غير نشطة"];
const CYCLES = ["شهري", "ربع سنوي", "نصف سنوي", "سنوي"];

const COLUMNS = [
  { key: "code", header: "رقم المكتب *", width: 12, group: "office" },
  { key: "type", header: "نوع المكتب *", width: 15, group: "office", list: TYPES },
  { key: "floor", header: "الدور", width: 10, group: "office" },
  { key: "capacity", header: "عدد المقاعد *", width: 11, group: "office", int: true },
  { key: "price", header: "الإيجار الشهري شامل الضريبة (ر.س) *", width: 18, group: "office", money: true },
  { key: "status", header: "حالة المكتب *", width: 13, group: "office", list: STATUSES },
  { key: "client", header: "اسم العميل / الشركة", width: 28, group: "client" },
  { key: "clientType", header: "نوع العميل", width: 11, group: "client", list: ["منشأة", "فرد"] },
  { key: "mobile", header: "جوال العميل", width: 14, group: "client" },
  { key: "start", header: "تاريخ بداية العقد", width: 15, group: "contract", date: true },
  { key: "months", header: "مدة العقد (بالأشهر)", width: 12, group: "contract", int: true },
  { key: "cycle", header: "طريقة الدفع", width: 12, group: "contract", list: CYCLES },
  { key: "paid", header: "المدفوع حتى اليوم (ر.س)", width: 14, group: "contract", money: true },
  { key: "seats", header: "المقاعد المؤجرة (للمكتب المشترك فقط)", width: 16, group: "extra", int: true },
  { key: "cr", header: "السجل التجاري", width: 13, group: "extra" },
  { key: "vat", header: "الرقم الضريبي", width: 17, group: "extra" },
  { key: "email", header: "البريد الإلكتروني", width: 22, group: "extra" },
  { key: "notes", header: "ملاحظات", width: 30, group: "extra" },
] as const;

const FILL = { office: "FFE8F0FA", client: "FFEAF7EE", contract: "FFFFF4DC", extra: "FFF1F1F1" } as const;
const GROUP_TITLE = { office: "بيانات المكتب", client: "العميل (للمؤجر فقط)", contract: "العقد والسداد (للمؤجر فقط)", extra: "اختياري" } as const;
const ROWS = 250;

export async function buildSimpleTemplate(branchName: string, prefill: SimpleRow[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ZAKI Smart ERP";

  // ── طريقة التعبئة ──
  const help = wb.addWorksheet("طريقة التعبئة", { views: [{ rightToLeft: true }] });
  help.getColumn(1).width = 4;
  help.getColumn(2).width = 110;
  const lines: [string, boolean?][] = [
    [`بيانات فرع ${branchName} — الشيت المبسّط`, true],
    ["سطر واحد لكل مكتب في الفرع (المؤجر والمتاح) في شيت «المكاتب». لا حاجة لأرقام مرجع أو شيتات منفصلة."],
    [""],
    ["المكتب المتاح:", true],
    ["  املأ الأعمدة الزرقاء فقط: رقم المكتب، النوع، عدد المقاعد، الإيجار الشهري، والحالة «متاحة»."],
    ["المكتب المؤجر:", true],
    ["  املأ نفس الأعمدة بحالة «مؤجرة»، ثم اسم العميل وجواله (الأخضر)، ثم تاريخ البداية والمدة وطريقة الدفع والمدفوع حتى اليوم (الأصفر)."],
    ["  العميل اللي عنده أكثر من مكتب بنفس العقد: اكتب اسمه بنفس الطريقة وبنفس التاريخ في سطر كل مكتب — يُسجل عقدًا واحدًا."],
    ["  المكتب المشترك المؤجر لأكثر من عميل: كرر رقم المكتب في سطر لكل عميل، واكتب «المقاعد المؤجرة» لكل واحد."],
    [""],
    ["ملاحظات:", true],
    ["  • الإيجار الشهري يُكتب شامل الضريبة. لقاعات الاجتماعات اكتب سعر الساعة."],
    ["  • التاريخ: اختر الخانة واكتبه بالشكل يوم/شهر/سنة (مثال 1/3/2026)."],
    ["  • الخانات الملونة بالأحمر الفاتح ناقصة ومطلوب تعبئتها."],
    ["  • الصف الرمادي الأول مثال للتوضيح فقط ولا يُستورد."],
    ["  • بعد التعبئة يُرفع الملف من صفحة الفرع ← «استيراد من Excel»، ويعرض النظام أي ملاحظة قبل الحفظ."],
  ];
  lines.forEach(([t, bold], i) => {
    const c = help.getCell(i + 2, 2);
    c.value = t;
    c.font = { bold: !!bold || i === 0, size: i === 0 ? 15 : 12, color: { argb: i === 0 ? "FF132E4B" : "FF333333" } };
    c.alignment = { wrapText: true, readingOrder: "rtl" };
  });

  // ── المكاتب ──
  const ws = wb.addWorksheet("المكاتب", { views: [{ rightToLeft: true, state: "frozen", ySplit: 3, xSplit: 1 }] });
  const n = COLUMNS.length;
  ws.mergeCells(1, 1, 1, n);
  ws.getCell(1, 1).value = `فرع ${branchName} — شيت المكاتب المبسّط (سطر لكل مكتب)`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF132E4B" } };
  ws.getRow(1).height = 24;
  // عناوين المجموعات
  let start = 1;
  for (const grp of ["office", "client", "contract", "extra"] as const) {
    const count = COLUMNS.filter((c) => c.group === grp).length;
    ws.mergeCells(2, start, 2, start + count - 1);
    const c = ws.getCell(2, start);
    c.value = GROUP_TITLE[grp];
    c.font = { bold: true, color: { argb: "FF132E4B" } };
    c.alignment = { horizontal: "center" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[grp] } };
    start += count;
  }
  COLUMNS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
    const h = ws.getCell(3, i + 1);
    h.value = col.header;
    h.font = { bold: true, color: { argb: "FF132E4B" } };
    h.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
    h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[col.group] } };
    h.border = { bottom: { style: "medium", color: { argb: "FF132E4B" } } };
  });
  ws.getRow(3).height = 42;

  // صف المثال (لا يُستورد)
  const example: SimpleRow = { code: "101", type: "مكتب خاص", floor: "الأول", capacity: 2, price: 1725, status: "مؤجرة", client: "شركة المثال للتقنية", clientType: "منشأة", mobile: "0551234567", start: new Date(Date.UTC(2026, 0, 1)), months: 12, cycle: "ربع سنوي", paid: 5175, notes: "مطل على الشارع" };
  const rows = [example, ...prefill];
  for (let r = 0; r < ROWS + 1; r++) {
    const data = rows[r] ?? {};
    const isExample = r === 0;
    const rowNo = r + 4;
    COLUMNS.forEach((col, i) => {
      const cell = ws.getCell(rowNo, i + 1);
      const v = data[col.key];
      if (v !== undefined && v !== null && v !== "") cell.value = v as ExcelJS.CellValue;
      if ("date" in col && col.date) cell.numFmt = "dd/mm/yyyy";
      if ("money" in col && col.money) cell.numFmt = "#,##0.00";
      if (!("money" in col) && !("int" in col) && !("date" in col)) cell.numFmt = "@"; // نص: لا تضيع أصفار الجوال
      if ("list" in col && col.list) cell.dataValidation = { type: "list", allowBlank: true, formulae: [`"${col.list.join(",")}"`], showErrorMessage: true, errorTitle: "اختيار غير صحيح", error: "اختر من القائمة" };
      else if ("int" in col && col.int) cell.dataValidation = { type: "whole", operator: "between", allowBlank: true, formulae: [0, 1000], showErrorMessage: true, error: "اكتب رقمًا صحيحًا" };
      else if ("money" in col && col.money) cell.dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [0, 10000000], showErrorMessage: true, error: "اكتب مبلغًا بالأرقام" };
      else if ("date" in col && col.date) cell.dataValidation = { type: "date", operator: "between", allowBlank: true, formulae: [new Date(Date.UTC(2015, 0, 1)), new Date(Date.UTC(2035, 11, 31))], showErrorMessage: true, error: "اكتب التاريخ بالشكل يوم/شهر/سنة" };
      cell.border = { bottom: { style: "hair", color: { argb: "FFD9D9D9" } } };
      if (isExample) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E5E5" } };
        cell.font = { italic: true, color: { argb: "FF7F7F7F" } };
      } else if (r <= prefill.length && missing(data, col.key)) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2E2" } };
      }
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** الخانات المطلوبة الناقصة في سطر معبأ مسبقًا */
function missing(d: SimpleRow, key: string) {
  const has = (k: keyof SimpleRow) => d[k] !== undefined && d[k] !== null && d[k] !== "";
  const office = ["code", "type", "capacity", "price", "status"];
  if (office.includes(key)) return !has(key as keyof SimpleRow);
  const rented = String(d.status ?? "") === "مؤجرة" || has("client");
  if (!rented) return false;
  if (["client", "mobile", "start", "months", "cycle", "paid"].includes(key)) return !has(key as keyof SimpleRow);
  return false;
}
