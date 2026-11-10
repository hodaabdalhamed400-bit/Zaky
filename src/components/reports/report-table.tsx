import type { Cell, Column, Row } from "@/services/reports.service";
import { formatDate } from "@/lib/dates";
import { formatSAR } from "@/lib/money";

export function formatCell(c: Column, v: Cell | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (c.type) {
    case "money":
      return c.header.includes("م²") ? Number(v).toLocaleString("en", { minimumFractionDigits: 2 }) : formatSAR(String(v));
    case "date":
      return formatDate(v instanceof Date ? v : new Date(String(v)));
    case "percent":
      return `${v}%`;
    case "int":
      return Number(v).toLocaleString("en");
    default:
      return String(v);
  }
}

/** جدول التقرير — نفس المكون للعرض والطباعة. */
export function ReportTable({ columns, rows, totals, compact }: { columns: Column[]; rows: Row[]; totals?: Row; compact?: boolean }) {
  const pad = compact ? "px-2 py-1" : "px-3 py-2";
  const num = (c: Column) => ["money", "int", "percent", "date"].includes(c.type);
  return (
    <table className={compact ? "w-full border-collapse text-[10px]" : "w-full min-w-[720px] text-sm"}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className={`${pad} border border-gray-200 bg-gray-50 text-start font-semibold text-gray-700`}>{c.header}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="break-inside-avoid">
            {columns.map((c) => (
              <td key={c.key} className={`${pad} border border-gray-100 ${num(c) ? "tabular whitespace-nowrap" : ""}`}>{formatCell(c, r[c.key])}</td>
            ))}
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr className="bg-brand-50 font-semibold">
            {columns.map((c) => (
              <td key={c.key} className={`${pad} border border-gray-200 ${num(c) ? "tabular whitespace-nowrap" : ""}`}>{totals[c.key] === undefined ? "" : formatCell(c, totals[c.key]!)}</td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

export function filtersSummary(f: { branchId?: string; from?: string; to?: string; status?: string }, branchName: string | null, statusLabel: string | null) {
  const parts = [`الفرع: ${branchName ?? "كل الفروع المتاحة"}`];
  if (f.from || f.to) parts.push(`الفترة: ${f.from ?? "…"} إلى ${f.to ?? "…"}`);
  if (statusLabel) parts.push(`الحالة: ${statusLabel}`);
  return parts.join(" · ");
}
