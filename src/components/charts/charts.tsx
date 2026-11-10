"use client";
import {
  Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipProps,
} from "recharts";

/**
 * ألوان الرسوم — مُتحقق منها بأداة فحص الألوان (فصل عمى الألوان ΔE 16.3، الرؤية العادية 16.2):
 * السلسلة 1 أزرق، السلسلة 2 سماوي هوية ذكي. السماوي أقل من 3:1 على الخلفية،
 * لذلك كل رسم معه وسيلة إيضاح وتلميح وجدول بيانات.
 */
/** الحركة عند الظهور، إلا إذا طلب المستخدم تقليل الحركة */
const ANIM = typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const S1 = "#2a78d6";
const S2 = "#1eadc0";
const GRID = "#e5e7eb";
const AXIS = "#6b7280";
const SURFACE = "#ffffff";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
export const monthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const monthLong = (ym: string) => `${monthShort(ym)} ${ym.slice(0, 4)}`;
const compact = new Intl.NumberFormat("ar-SA-u-nu-latn", { notation: "compact", maximumFractionDigits: 1 });
const money = new Intl.NumberFormat("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Series = { key: string; label: string; color: string };

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-gray-600" aria-label="وسيلة الإيضاح">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md" dir="rtl">
      <p className="mb-1 font-semibold text-gray-900">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-gray-600">
          <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm" style={{ background: r.color }} />{r.label}</span>
          <span className="tabular font-medium text-gray-900">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

function makeTip(series: Series[], fmt: (v: number | null) => string, title: (label: string) => string) {
  return function Tip({ active, payload, label }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    return (
      <TipBox
        title={title(String(label))}
        rows={series.map((s) => {
          const p = payload.find((x) => x.dataKey === s.key);
          return { label: s.label, value: fmt(p?.value === undefined || p?.value === null ? null : Number(p.value)), color: s.color };
        })}
      />
    );
  };
}

export function ChartFrame({
  title,
  subtitle,
  series,
  table,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  series: Series[];
  table: { headers: string[]; rows: (string | number)[][] };
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-up rounded-2xl border border-gray-200/80 bg-white p-5 shadow-[0_1px_2px_rgb(16_24_40/0.04),0_4px_16px_-6px_rgb(19_46_75/0.08)] transition-shadow duration-300 hover:shadow-[0_2px_4px_rgb(16_24_40/0.05),0_12px_28px_-10px_rgb(19_46_75/0.16)]" aria-label={title}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900"><span className="h-4 w-1 rounded-full bg-gradient-to-b from-accent-500 to-brand-700" aria-hidden="true" />{title}</h2>
          {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
        </div>
        <Legend series={series} />
      </div>
      {empty ? (
        <div className="grid h-56 place-items-center rounded-lg bg-gray-50 text-sm text-gray-500">لا توجد بيانات كافية للرسم بعد</div>
      ) : (
        <div className="h-64" role="img" aria-label={`${title} — التفاصيل في جدول البيانات أدناه`}>
          {children}
        </div>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs text-brand-700">عرض البيانات كجدول</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-xs">
            <thead><tr>{table.headers.map((h) => <th key={h} className="bg-gray-50 px-2 py-1.5 text-start font-semibold text-gray-600">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="tabular border-t border-gray-100 px-2 py-1.5">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const pctFmt = (v: number | null) => (v === null ? "—" : `${v}%`);
const sar = (v: number | null) => (v === null ? "—" : `${money.format(v)} ر.س`);

/** الإشغال حسب الفرع — أعمدة أفقية (المقارنة بين فئات بأسماء طويلة). */
export function OccupancyByBranchChart({ data }: { data: { name: string; unitsPct: number | null; seatsPct: number | null; units: number }[] }) {
  const rows = data.filter((d) => d.units > 0);
  const series: Series[] = [
    { key: "unitsPct", label: "حسب الوحدات", color: S1 },
    { key: "seatsPct", label: "حسب المقاعد", color: S2 },
  ];
  return (
    <ChartFrame
      title="نسبة الإشغال حسب الفرع"
      subtitle="اليوم — الفروع التي لها وحدات"
      series={series}
      empty={rows.length === 0}
      table={{ headers: ["الفرع", "حسب الوحدات", "حسب المقاعد", "الوحدات"], rows: data.map((d) => [d.name, pctFmt(d.unitsPct), pctFmt(d.seatsPct), d.units]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis type="number" domain={[0, 100]} reversed tickFormatter={(v) => `${v}%`} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" orientation="right" width={96} tick={{ fill: "#374151", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f3f4f6" }} content={makeTip(series, pctFmt, (l) => l)} />
          <Bar isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out" dataKey="unitsPct" fill={S1} radius={[4, 0, 0, 4]} maxBarSize={14} stroke={SURFACE} strokeWidth={0} />
          <Bar isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out" dataKey="seatsPct" fill={S2} radius={[4, 0, 0, 4]} maxBarSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** المستحق مقابل المحصّل شهريًا — أعمدة متجاورة (مقياس واحد: ر.س). */
export function MoneyChart({ data }: { data: { month: string; billed: number; collected: number }[] }) {
  const series: Series[] = [
    { key: "billed", label: "أقساط مستحقة في الشهر", color: S1 },
    { key: "collected", label: "المحصّل في الشهر", color: S2 },
  ];
  const empty = data.every((d) => !d.billed && !d.collected);
  return (
    <ChartFrame
      title="المستحقات مقابل المحصّل"
      subtitle="شهريًا، شامل الضريبة — الدفعات المعتمدة فقط"
      series={series}
      empty={empty}
      table={{ headers: ["الشهر", "مستحق", "محصّل"], rows: data.map((d) => [monthLong(d.month), sar(d.billed), sar(d.collected)]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="month" reversed tickFormatter={monthShort} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" />
          <YAxis orientation="right" tickFormatter={(v) => compact.format(v)} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip cursor={{ fill: "#f3f4f6" }} content={makeTip(series, sar, monthLong)} />
          <Bar isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out" dataKey="billed" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={16} />
          <Bar isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out" dataKey="collected" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** العقود الجديدة والمنتهية شهريًا. */
export function ContractsFlowChart({ data }: { data: { month: string; started: number; ended: number }[] }) {
  const series: Series[] = [
    { key: "started", label: "عقود بدأت", color: S1 },
    { key: "ended", label: "عقود انتهت / أُنهيت", color: S2 },
  ];
  const fmt = (v: number | null) => (v === null ? "—" : String(v));
  return (
    <ChartFrame
      title="العقود الجديدة والمنتهية"
      subtitle="حسب الشهر"
      series={series}
      empty={data.every((d) => !d.started && !d.ended)}
      table={{ headers: ["الشهر", "بدأت", "انتهت"], rows: data.map((d) => [monthLong(d.month), d.started, d.ended]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} barGap={2} barCategoryGap="24%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="month" reversed tickFormatter={monthShort} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" />
          <YAxis orientation="right" allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
          <Tooltip cursor={{ fill: "#f3f4f6" }} content={makeTip(series, fmt, monthLong)} />
          <Bar isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out" dataKey="started" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={16} />
          <Bar isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out" dataKey="ended" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** تطور الإشغال — خطان على نفس المقياس (%)، مع تسمية مباشرة لآخر قيمة. */
export function OccupancyTrendChart({ data }: { data: { month: string; unitsPct: number | null; seatsPct: number | null }[] }) {
  const series: Series[] = [
    { key: "unitsPct", label: "حسب الوحدات", color: S1 },
    { key: "seatsPct", label: "حسب المقاعد", color: S2 },
  ];
  const last = data.length - 1;
  const endLabel = (key: "unitsPct" | "seatsPct") =>
    function EndLabel(props: { x?: number | string; y?: number | string; index?: number; value?: number | string }) {
      if (props.index !== last || props.value === null || props.value === undefined) return null;
      return <text x={Number(props.x) - 8} y={Number(props.y) + (key === "unitsPct" ? -8 : 14)} textAnchor="end" fontSize={11} fill="#374151">{`${props.value}%`}</text>;
    };
  return (
    <ChartFrame
      title="تطور الإشغال"
      subtitle="في آخر يوم من كل شهر"
      series={series}
      empty={data.every((d) => d.unitsPct === null)}
      table={{ headers: ["الشهر", "حسب الوحدات", "حسب المقاعد"], rows: data.map((d) => [monthLong(d.month), pctFmt(d.unitsPct), pctFmt(d.seatsPct)]) }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 0, left: 24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="month" reversed tickFormatter={monthShort} tick={{ fill: AXIS, fontSize: 11 }} axisLine={{ stroke: GRID }} tickLine={false} interval="preserveStartEnd" />
          <YAxis orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: AXIS, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ stroke: "#9ca3af", strokeDasharray: "3 3" }} content={makeTip(series, pctFmt, monthLong)} />
          {series.map((s) => (
            <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 4, fill: s.color, stroke: SURFACE, strokeWidth: 2 }} activeDot={{ r: 5, stroke: SURFACE, strokeWidth: 2 }} connectNulls isAnimationActive={ANIM} animationDuration={900} animationEasing="ease-out">
              <LabelList dataKey={s.key} content={endLabel(s.key as "unitsPct" | "seatsPct")} />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
