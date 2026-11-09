import type { OccupancySummary } from "@/services/occupancy.service";

export function OccupancyBar({ pct, label }: { pct: number | null; label?: string }) {
  const v = pct ?? 0;
  const color = pct === null ? "bg-gray-200" : v >= 85 ? "bg-emerald-500" : v >= 50 ? "bg-accent-500" : "bg-amber-500";
  return (
    <div className="min-w-28">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular font-semibold text-gray-900">{pct === null ? "—" : `${pct}%`}</span>
        {label && <span className="text-gray-400">{label}</span>}
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-valuenow={pct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ? `نسبة الإشغال ${label}` : "نسبة الإشغال"}
      >
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
    </div>
  );
}

/** النسب الثلاث مع أساس كل منها — حتى لا تُقرأ نسبة دون معرفة طريقة حسابها. */
export function OccupancyBreakdown({ o }: { o: OccupancySummary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div>
        <OccupancyBar pct={o.unitsPct} label="حسب الوحدات" />
        <p className="tabular mt-1 text-xs text-gray-500">{o.occupiedUnits} من {o.units} وحدة</p>
      </div>
      <div>
        <OccupancyBar pct={o.seatsPct} label="حسب المقاعد" />
        <p className="tabular mt-1 text-xs text-gray-500">{o.occupiedSeats} من {o.seats} مقعد</p>
      </div>
      <div>
        <OccupancyBar pct={o.unitsWithoutArea > 0 ? null : o.areaPct} label="حسب المساحة" />
        <p className="tabular mt-1 text-xs text-gray-500">
          {o.unitsWithoutArea > 0
            ? `غير مكتمل: ${o.unitsWithoutArea} وحدة بلا مساحة`
            : `${Number(o.occupiedArea).toLocaleString("en")} من ${Number(o.area).toLocaleString("en")} م²`}
        </p>
      </div>
    </div>
  );
}
