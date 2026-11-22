/** غرفة في مخطط فرع جاهز (بالأمتار). FACILITY = مرافق ليست وحدات (دورات مياه...). */
export type PlanRoom = {
  code: string;
  type: "PRIVATE_OFFICE" | "SHARED_OFFICE" | "MEETING_ROOM" | "ADMIN_SPACE" | "FACILITY";
  x: number;
  y: number;
  w: number;
  d: number;
  capacity: number;
  label?: string;
  /** نوع المرفق للمجسم: دورات مياه (الافتراضي) أو ركن قهوة */
  facility?: "wc" | "coffee";
  /** اسم الدور في المباني متعددة الأدوار (الأرضي، الأول…) — يُطابَق مع أدوار الفرع المسجلة بالاسم */
  floor?: string;
};
export type BranchPlan = PlanRoom[];
