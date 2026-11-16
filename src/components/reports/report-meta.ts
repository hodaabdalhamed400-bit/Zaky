import type { IconName } from "@/components/ui/icons";

/** شكل كل تقرير في الواجهة: الأيقونة والمجموعة ولون الشارة. لا يؤثر على البيانات. */
export type ReportGroup = "ops" | "leasing" | "money" | "control" | "other";

export const REPORT_GROUPS: { key: ReportGroup; title: string; hint: string }[] = [
  { key: "ops", title: "الفروع والإشغال", hint: "أداء الفروع وحالة الوحدات اليوم" },
  { key: "leasing", title: "المستأجرون والعقود", hint: "العملاء والعقود السارية والمنتهية" },
  { key: "money", title: "المالية", hint: "التحصيل والمتأخرات والمصروفات" },
  { key: "control", title: "الرقابة", hint: "سجل نشاط الموظفين" },
  { key: "other", title: "تقارير أخرى", hint: "" },
];

const TONES = {
  brand: "from-accent-500 to-brand-700 shadow-accent-500/30",
  sky: "from-sky-400 to-sky-600 shadow-sky-500/30",
  violet: "from-violet-400 to-violet-600 shadow-violet-500/30",
  emerald: "from-emerald-500 to-emerald-700 shadow-emerald-500/30",
  rose: "from-rose-500 to-red-700 shadow-red-500/30",
  amber: "from-amber-400 to-amber-600 shadow-amber-500/30",
  slate: "from-slate-500 to-slate-700 shadow-slate-500/30",
};

export type ReportMeta = { icon: IconName; group: ReportGroup; tone: string; bar: string };

const M = (icon: IconName, group: ReportGroup, tone: keyof typeof TONES): ReportMeta => ({
  icon,
  group,
  tone: TONES[tone],
  bar: TONES[tone].split(" shadow")[0] ?? "",
});

const META: Record<string, ReportMeta> = {
  branches: M("branches", "ops", "brand"),
  occupancy: M("units", "ops", "sky"),
  tenants: M("tenants", "leasing", "violet"),
  contracts: M("contracts", "leasing", "brand"),
  expired: M("calendar", "leasing", "slate"),
  collections: M("finance", "money", "emerald"),
  overdue: M("alert", "money", "rose"),
  purchases: M("receipt", "money", "amber"),
  activity: M("audit", "control", "slate"),
};

export function reportMeta(key: string): ReportMeta {
  return META[key] ?? M("reports", "other", "brand");
}

export const FILTER_LABELS = { branch: "الفرع", dateRange: "الفترة", status: "الحالة" } as const;
