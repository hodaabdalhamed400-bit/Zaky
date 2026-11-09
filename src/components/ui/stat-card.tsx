import { Icon, type IconName } from "./icons";
import { cx } from "./primitives";

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
  const toneCls = {
    default: "bg-brand-50 text-brand-700",
    good: "bg-emerald-50 text-emerald-700",
    warn: "bg-amber-50 text-amber-700",
    bad: "bg-red-50 text-red-700",
  }[tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-500">{label}</p>
        <span className={cx("rounded-lg p-2", toneCls)}>
          <Icon name={icon} className="size-4" />
        </span>
      </div>
      <p className="tabular mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
