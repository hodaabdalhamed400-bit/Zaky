import type { Db } from "@/lib/db";
import { todayInRiyadh } from "@/lib/dates";
import { runContractMaintenance } from "./contracts.service";
import { runNotificationJob } from "./notifications.service";
import { runWeeklyDigest } from "./weekly-digest.service";
import { runWeeklyBackup } from "./backup.service";

/** المهمة اليومية الكاملة: تحديث حالات العقود ثم التنبيهات (بعدها حتى تُبنى على الحالة الجديدة). */
export async function runDaily(db: Db, today = todayInRiyadh()) {
  const contracts = await runContractMaintenance(db, today);
  const notifications = await runNotificationJob(db, today);
  // الملخص الأسبوعي (الأحد فقط) — فشله لا يوقف المهمة اليومية
  const digest = await runWeeklyDigest(db, today).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  // النسخة الاحتياطية الأسبوعية بالإيميل — فشلها لا يوقف المهمة اليومية
  const backup = await runWeeklyBackup(db, today).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  return { today, contracts, notifications, digest, backup };
}
