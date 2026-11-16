import type { Cell, Column, Row } from "@/services/reports.service";
import { formatDate } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { cx } from "@/components/ui/primitives";

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
  if (!compact) return <ScreenTable columns={columns} rows={rows} totals={totals} num={num} />;
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

/** نسخة الشاشة: رأس ثابت، صفوف متناوبة، وأرقام بخط أوضح. الطباعة تستخدم النسخة المضغوطة أعلاه. */
function ScreenTable({ columns, rows, totals, num }: { columns: Column[]; rows: Row[]; totals?: Row; num: (c: Column) => boolean }) {
  const strong = (c: Column) => c.type === "money";
  return (
    <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.key} scope="col" className="sticky top-0 z-10 whitespace-nowrap border-b border-gray-200 bg-gray-50/95 px-4 py-3 text-start text-xs font-semibold text-brand-700/80 backdrop-blur">
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="transition-colors even:bg-gray-50/50 hover:bg-accent-50/60">
            {columns.map((c, ci) => {
              const v = formatCell(c, r[c.key]);
              return (
                <td
                  key={c.key}
                  className={cx(
                    "border-b border-gray-100 px-4 py-2.5 align-middle",
                    num(c) && "tabular whitespace-nowrap",
                    strong(c) ? "font-medium text-gray-900" : "text-gray-700",
                    ci === 0 && "font-medium text-gray-900",
                    v === "—" && "text-gray-300",
                  )}
                >
                  {v}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
      {totals && (
        <tfoot>
          <tr>
            {columns.map((c) => (
              <td key={c.key} className={cx("sticky bottom-0 border-t-2 border-brand-200 bg-brand-50/95 px-4 py-3 font-bold text-brand-900 backdrop-blur", num(c) && "tabular whitespace-nowrap")}>
                {totals[c.key] === undefined ? "" : formatCell(c, totals[c.key]!)}
              </td>
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
