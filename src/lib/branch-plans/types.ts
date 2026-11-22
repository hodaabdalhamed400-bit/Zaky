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
};
export type BranchPlan = PlanRoom[];
