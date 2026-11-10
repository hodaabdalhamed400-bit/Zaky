import { CountUp } from "./count-up";
import { Icon, type IconName } from "./icons";
import { cx } from "./primitives";

const TONE = {
  default: { chip: "from-accent-500 to-brand-700 shadow-accent-500/30", glow: "bg-accent-500/10", bar: "from-accent-500 to-brand-700" },
  good: { chip: "from-emerald-500 to-emerald-700 shadow-emerald-500/30", glow: "bg-emerald-500/10", bar: "from-emerald-400 to-emerald-600" },
  warn: { chip: "from-amber-400 to-amber-600 shadow-amber-500/30", glow: "bg-amber-500/10", bar: "from-amber-300 to-amber-500" },
  bad: { chip: "from-rose-500 to-red-700 shadow-red-500/30", glow: "bg-red-500/10", bar: "from-rose-400 to-red-600" },
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon: IconName;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const t = TONE[tone];
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-gray-200/80 bg-white p-4 shadow-[0_1px_2px_rgb(16_24_40/0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-accent-500/30 hover:shadow-[0_14px_30px_-12px_rgb(19_46_75/0.25)]">
      <div className={cx("pointer-events-none absolute -top-10 -start-10 size-28 rounded-full blur-2xl transition-transform duration-500 group-hover:scale-150", t.glow)} aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 group-hover:rotate-[-8deg] group-hover:scale-110", t.chip)}>
          <Icon name={icon} className="size-4.5" />
        </span>
      </div>
      <p className="tabular relative mt-2 text-2xl font-bold tracking-tight text-brand-900">
        <CountUp value={value} />
      </p>
      {hint && <p className="relative mt-1 text-xs text-gray-500">{hint}</p>}
      <div className={cx("absolute inset-x-0 bottom-0 h-0.5 origin-right scale-x-0 bg-gradient-to-l transition-transform duration-500 group-hover:scale-x-100", t.bar)} aria-hidden="true" />
    </div>
  );
}
