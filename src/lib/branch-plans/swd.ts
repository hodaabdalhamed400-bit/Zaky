import type { BranchPlan } from "./types";

/**
 * فرع السويدي — مستخرج من مخطط الفرع المعماري (صورة المخطط المرسلة من الإدارة).
 * المقياس ≈ 26 بكسل/متر، والمخطط مُدار 90° ليكون الطول أفقيًا. أرقام المكاتب مقترحة:
 * 101–105 الصف العلوي، 106–116 العمود الأيمن (من الأعلى)، 117–125 الصف السفلي (من اليمين)،
 * 126–130 و131–135 صفا المكاتب 5م² في الوسط، 136 مكتب 10م².
 */
export const SWD_PLAN: BranchPlan = [
  { code: "101", type: "PRIVATE_OFFICE", x: 39.88, y: 0.54, w: 4.46, d: 2.08, capacity: 1 },
  { code: "102", type: "PRIVATE_OFFICE", x: 41.08, y: 2.62, w: 3.27, d: 2.23, capacity: 1 },
  { code: "103", type: "PRIVATE_OFFICE", x: 41.08, y: 5.31, w: 3.27, d: 2.62, capacity: 1 },
  { code: "104", type: "PRIVATE_OFFICE", x: 41.08, y: 7.92, w: 3.27, d: 2.58, capacity: 1 },
  { code: "105", type: "PRIVATE_OFFICE", x: 40.38, y: 11.0, w: 3.96, d: 2.31, capacity: 1 },
  { code: "106", type: "PRIVATE_OFFICE", x: 36.46, y: 11.0, w: 3.15, d: 2.5, capacity: 1 },
  { code: "107", type: "PRIVATE_OFFICE", x: 33.96, y: 11.0, w: 2.5, d: 2.69, capacity: 1 },
  { code: "108", type: "PRIVATE_OFFICE", x: 31.35, y: 11.0, w: 2.62, d: 2.85, capacity: 1 },
  { code: "109", type: "PRIVATE_OFFICE", x: 29.23, y: 11.0, w: 2.12, d: 3.0, capacity: 1 },
  { code: "110", type: "PRIVATE_OFFICE", x: 26.81, y: 11.0, w: 2.42, d: 3.12, capacity: 1 },
  { code: "111", type: "PRIVATE_OFFICE", x: 24.42, y: 11.0, w: 2.12, d: 3.31, capacity: 1 },
  { code: "112", type: "PRIVATE_OFFICE", x: 22.04, y: 11.0, w: 2.38, d: 3.42, capacity: 1 },
  { code: "113", type: "PRIVATE_OFFICE", x: 19.81, y: 11.0, w: 2.23, d: 3.58, capacity: 1 },
  { code: "114", type: "PRIVATE_OFFICE", x: 17.62, y: 11.0, w: 2.19, d: 3.69, capacity: 1 },
  { code: "115", type: "PRIVATE_OFFICE", x: 15.0, y: 11.0, w: 2.62, d: 3.85, capacity: 1 },
  { code: "116", type: "PRIVATE_OFFICE", x: 12.62, y: 11.0, w: 2.38, d: 4.0, capacity: 1 },
  { code: "117", type: "PRIVATE_OFFICE", x: 0.08, y: 14.46, w: 2.81, d: 1.62, capacity: 1 },
  { code: "118", type: "PRIVATE_OFFICE", x: 0.08, y: 13.08, w: 2.81, d: 1.38, capacity: 1 },
  { code: "119", type: "PRIVATE_OFFICE", x: 0.08, y: 10.88, w: 2.81, d: 1.81, capacity: 1 },
  { code: "120", type: "PRIVATE_OFFICE", x: 0.08, y: 9.15, w: 2.81, d: 1.73, capacity: 1 },
  { code: "121", type: "PRIVATE_OFFICE", x: 0.08, y: 7.31, w: 2.81, d: 1.85, capacity: 1 },
  { code: "122", type: "PRIVATE_OFFICE", x: 0.08, y: 5.54, w: 2.81, d: 1.77, capacity: 1 },
  { code: "123", type: "PRIVATE_OFFICE", x: 0.08, y: 3.73, w: 2.81, d: 1.81, capacity: 1 },
  { code: "124", type: "PRIVATE_OFFICE", x: 0.08, y: 1.92, w: 2.81, d: 1.81, capacity: 1 },
  { code: "125", type: "PRIVATE_OFFICE", x: 0.08, y: 0.08, w: 2.81, d: 1.85, capacity: 1 },
  { code: "126", type: "PRIVATE_OFFICE", x: 7.5, y: 0.08, w: 3.0, d: 1.85, capacity: 1 },
  { code: "127", type: "PRIVATE_OFFICE", x: 7.5, y: 1.92, w: 3.0, d: 1.81, capacity: 1 },
  { code: "128", type: "PRIVATE_OFFICE", x: 7.5, y: 3.73, w: 3.0, d: 1.81, capacity: 1 },
  { code: "129", type: "PRIVATE_OFFICE", x: 7.5, y: 5.54, w: 3.0, d: 1.77, capacity: 1 },
  { code: "130", type: "PRIVATE_OFFICE", x: 7.5, y: 7.31, w: 3.0, d: 1.77, capacity: 1 },
  { code: "131", type: "PRIVATE_OFFICE", x: 14.5, y: 0.08, w: 3.0, d: 1.85, capacity: 1 },
  { code: "132", type: "PRIVATE_OFFICE", x: 14.5, y: 1.92, w: 3.0, d: 1.81, capacity: 1 },
  { code: "133", type: "PRIVATE_OFFICE", x: 14.5, y: 3.73, w: 3.0, d: 1.81, capacity: 1 },
  { code: "134", type: "PRIVATE_OFFICE", x: 14.5, y: 5.54, w: 3.0, d: 1.77, capacity: 1 },
  { code: "135", type: "PRIVATE_OFFICE", x: 14.5, y: 7.31, w: 3.0, d: 1.77, capacity: 1 },
  { code: "136", type: "PRIVATE_OFFICE", x: 19.73, y: 6.77, w: 5.15, d: 2.38, capacity: 1 },
  { code: "مشترك 1", type: "SHARED_OFFICE", x: 33.08, y: 0.54, w: 6.65, d: 8.62, capacity: 24 },
  { code: "مشترك 2", type: "SHARED_OFFICE", x: 26.15, y: 3.73, w: 6.81, d: 5.42, capacity: 16 },
  { code: "مشترك 3", type: "SHARED_OFFICE", x: 10.88, y: 0.08, w: 3.46, d: 9.0, capacity: 12 },
  { code: "مشترك 4", type: "SHARED_OFFICE", x: 3.0, y: 0.08, w: 4.35, d: 9.08, capacity: 12 },
  { code: "قاعة 1", type: "MEETING_ROOM", x: 25.88, y: 0.08, w: 6.85, d: 3.62, capacity: 12 },
  { code: "قاعة 2", type: "MEETING_ROOM", x: 19.73, y: 3.73, w: 5.15, d: 2.96, capacity: 6 },
  { code: "الاستقبال", type: "ADMIN_SPACE", x: 19.73, y: 0.08, w: 5.15, d: 3.62, capacity: 2 },
  { code: "WC", type: "FACILITY", x: 4.81, y: 10.5, w: 7.62, d: 5.19, capacity: 0, label: "دورات المياه" },
];
