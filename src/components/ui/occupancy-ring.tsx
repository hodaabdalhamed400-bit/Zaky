import { cx } from "./primitives";

/** حلقة نسبة إشغال متحركة (تمتلئ عند الظهور). اللون يتبع النسبة، والرقم مكتوب دائمًا بجانب اللون. */
export function OccupancyRing({ pct, size = 88, stroke = 8, label, className }: { pct: number | null; size?: number; stroke?: number; label?: string; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct ?? 0));
  const color = pct === null ? "#CBD5E1" : v >= 85 ? "#10B981" : v >= 50 ? "#1EADC0" : "#F59E0B";
  return (
    <div className={cx("relative grid place-items-center", className)} style={{ width: size, height: size }} role="img" aria-label={`${label ?? "نسبة الإشغال"}: ${pct === null ? "لا توجد وحدات" : `${pct}%`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E8EEF4" strokeWidth={stroke} />
        {pct !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - v / 100)}
            className="ring-anim"
            style={{ ["--ring-c" as string]: `${c}` }}
          />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center leading-tight">
        <div>
          <p className="tabular font-bold text-brand-900" style={{ fontSize: size * 0.22 }}>{pct === null ? "—" : `${Math.round(v)}%`}</p>
          {label && <p className="text-gray-500" style={{ fontSize: Math.max(10, size * 0.11) }}>{label}</p>}
        </div>
      </div>
    </div>
  );
}
