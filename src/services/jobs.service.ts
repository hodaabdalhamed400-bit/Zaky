import type { Db } from "@/lib/db";
import { todayInRiyadh } from "@/lib/dates";
import { runContractMaintenance } from "./contracts.service";
import { runNotificationJob } from "./notifications.service";

/** المهمة اليومية الكاملة: تحديث حالات العقود ثم التنبيهات (بعدها حتى تُبنى على الحالة الجديدة). */
export async function runDaily(db: Db, today = todayInRiyadh()) {
  const contracts = await runContractMaintenance(db, today);
  const notifications = await runNotificationJob(db, today);
  return { today, contracts, notifications };
}
