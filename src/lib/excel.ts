import ExcelJS from "exceljs";
import type { Column, Row } from "@/services/reports.service";

/**
 * ملف Excel عربي: ورقة من اليمين لليسار، ترويسة بهوية ذكي، أعمدة مالية كأرقام حقيقية
 * (قابلة للجمع في Excel) بتنسيق #,##0.00، والتواريخ كتواريخ.
 * القيم النصية تُكتب كنص دائمًا (لا تُفسَّر كصيغ — يمنع حقن الصيغ).
 */
export async function buildWorkbook(opts: {
  title: string;
  subtitle: string;
  generatedBy: string;
  columns: Column[];
  rows: Row[];
  totals?: Row;
  note?: string;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ZAKI Smart ERP";
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.title.slice(0, 31), {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 4 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });
  const n = opts.columns.length;

  ws.mergeCells(1, 1, 1, n);
  ws.getCell(1, 1).value = `شركة ذكي لحاضنات ومسرعات الأعمال — ${opts.title}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: "FF132E4B" } };
  ws.mergeCells(2, 1, 2, n);
  ws.getCell(2, 1).value = opts.subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: "FF52514E" } };
  ws.mergeCells(3, 1, 3, n);
  ws.getCell(3, 1).value = `أُنشئ بواسطة ${opts.generatedBy} في ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date())} (توقيت الرياض)`;
  ws.getCell(3, 1).font = { size: 9, color: { argb: "FF8A8A8A" } };

  const header = ws.getRow(4);
  opts.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF132E4B" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  header.height = 22;

  const write = (row: ExcelJS.Row, r: Row, bold = false) => {
    opts.columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = r[c.key];
      if (v === null || v === undefined || v === "") {
        cell.value = null;
      } else if (c.type === "money") {
        cell.value = Number(v);
        cell.numFmt = "#,##0.00";
      } else if (c.type === "int") {
        cell.value = Number(v);
        cell.numFmt = "#,##0";
      } else if (c.type === "percent") {
        cell.value = Number(v) / 100;
        cell.numFmt = "0.0%";
      } else if (c.type === "date") {
        cell.value = v instanceof Date ? v : new Date(String(v));
        cell.numFmt = "yyyy-mm-dd";
      } else {
        cell.value = { richText: [{ text: String(v) }] }; // نص صريح، لا صيغة
      }
      if (bold) cell.font = { bold: true };
    });
  };
  for (const r of opts.rows) write(ws.addRow([]), r);
  if (opts.totals) {
    const t = ws.addRow([]);
    write(t, opts.totals, true);
    t.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3F8" } }));
  }
  if (opts.note) {
    const r = ws.addRow([]);
    ws.mergeCells(r.number + 1, 1, r.number + 1, n);
    ws.getCell(r.number + 1, 1).value = opts.note;
    ws.getCell(r.number + 1, 1).font = { italic: true, size: 9, color: { argb: "FF52514E" } };
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + opts.rows.length, column: n } };
  opts.columns.forEach((c, i) => {
    const longest = Math.max(c.header.length, ...opts.rows.slice(0, 300).map((r) => String(r[c.key] ?? "").length));
    ws.getColumn(i + 1).width = Math.min(45, Math.max(c.type === "date" ? 12 : 10, longest + 4));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
