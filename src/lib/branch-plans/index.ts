import type { BranchPlan } from "./types";
import { SWD_PLAN } from "./swd";
import { GRN_PLAN } from "./grn";
import { RWD_PLAN } from "./rwd";

export type { BranchPlan, PlanRoom } from "./types";

/** مخططات الفروع الجاهزة (حسب رمز الفرع) — تُستخرج من المخططات المعمارية التي ترسلها الإدارة. */
export const BRANCH_PLANS: Record<string, BranchPlan> = {
  SWD: SWD_PLAN,
  GRN: GRN_PLAN,
  RWD: RWD_PLAN,
};
