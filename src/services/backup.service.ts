import type { Db } from "@/lib/db";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit";
import { createBackup, MIN_PASSPHRASE } from "@/lib/backup";
import { env } from "@/lib/env";
import { todayInRiyadh } from "@/lib/dates";
import { AppError, ForbiddenError } from "@/lib/errors";
import { brandedEmail, mailConfigured, sendMail } from "@/lib/mail";

/** النسخ الاحتياطي متاح لمسؤول النظام فقط (يحتوي كل بيانات الشركة). */
export function assertCanBackup(actor: Actor) {
  if (actor.roleKey !== "SUPER_ADMIN") throw new ForbiddenError();
}

const EMAIL_LIMIT = 20 * 1024 * 1024; // أغلب صناديق البريد تقبل حتى 25 ميجابايت
const LAST_KEY = "backup.weekly_last_sent";

export function backupEmailStatus() {
  const e = env();
  const recipients = (e.BACKUP_EMAIL ?? "").split(/[,;\s]+/).filter((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  return { mail: mailConfigured(), passphrase: !!e.BACKUP_PASSPHRASE, recipients: recipients.length, ready: mailConfigured() && !!e.BACKUP_PASSPHRASE && recipients.length > 0, list: recipients };
}

/** تنزيل يدوي: نسخة كاملة مشفرة بكلمة سر يختارها المسؤول. */
export async function downloadBackup(db: Db, actor: Actor, passphrase: string, includeFiles: boolean, meta: RequestMeta = {}) {
  assertCanBackup(actor);
  if (passphrase.length < MIN_PASSPHRASE) throw new AppError("VALIDATION", `كلمة سر النسخة يجب ألا تقل عن ${MIN_PASSPHRASE} حرفًا`);
  const { file, info } = await createBackup(db, passphrase, { includeFiles });
  await writeAudit(db, { actorId: actor.id, action: "system.backup_download", entityType: "system", after: { tables: Object.keys(info.tables).length, rows: Object.values(info.tables).reduce((a, b) => a + b, 0), files: info.files, size: file.length }, meta });
  return { file, info };
}

/**
 * نسخة أسبوعية تلقائية بالإيميل (ضمن المهمة اليومية): مرة كل 7 أيام على الأقل، مشفرة بـ BACKUP_PASSPHRASE.
 * قاعدة البيانات فقط (الملفات المرفوعة في التنزيل اليدوي) حتى يبقى حجم المرفق مناسبًا.
 */
export async function runWeeklyBackup(db: Db, today = todayInRiyadh(), send = sendMail) {
  const st = backupEmailStatus();
  if (!st.ready && send === sendMail) return { skipped: !st.mail ? "mail-not-configured" : !st.passphrase ? "no-passphrase" : "no-recipients" };
  const last = await db.systemSetting.findUnique({ where: { key: LAST_KEY } });
  if (typeof last?.value === "string" && (Date.parse(today) - Date.parse(last.value)) / 86_400_000 < 7) return { skipped: "not-due" };
  const { file, info } = await createBackup(db, env().BACKUP_PASSPHRASE ?? "test-passphrase-only");
  if (file.length > EMAIL_LIMIT) {
    await writeAudit(db, { actorId: null, action: "system.backup_email_failed", entityType: "system", after: { reason: "too-large", size: file.length } });
    return { skipped: "too-large", size: file.length };
  }
  const rows = Object.values(info.tables).reduce((a, b) => a + b, 0);
  const body = brandedEmail({
    title: "النسخة الاحتياطية الأسبوعية",
    lines: [
      `مرفق نسخة احتياطية كاملة من قاعدة بيانات ذكي ERP بتاريخ ${today} (${rows.toLocaleString("en")} سجل).`,
      "الملف مشفّر بكلمة سر النسخ الاحتياطي المحفوظة لدى الإدارة، ولا يُفتح بدونها.",
      "احتفظ بالرسالة (أو حمّل الملف إلى مكان آمن) — تُستخدم لاسترجاع البيانات عند أي طارئ.",
    ],
    footer: "تصلك هذه الرسالة أسبوعيًا لأن بريدك مسجل لاستلام النسخ الاحتياطية.",
  });
  let sent = 0;
  for (const to of st.list.length ? st.list : ["backup@test.local"]) {
    try {
      await send({ to, subject: `نسخة احتياطية — ذكي ERP — ${today}`, ...body, attachments: [{ filename: `zaki-erp-backup-${today}.zakibak`, content: file }] });
      sent++;
    } catch (e) {
      console.error("[weekly-backup]", e instanceof Error ? e.message : e);
    }
  }
  if (sent) await db.systemSetting.upsert({ where: { key: LAST_KEY }, create: { key: LAST_KEY, value: today, description: "آخر نسخة احتياطية أُرسلت بالإيميل (تلقائي)" }, update: { value: today } });
  await writeAudit(db, { actorId: null, action: sent ? "system.backup_email" : "system.backup_email_failed", entityType: "system", after: { sent, rows, size: file.length } });
  return { sent, size: file.length };
}

export async function lastBackups(db: Db) {
  return db.auditLog.findMany({
    where: { action: { in: ["system.backup_email", "system.backup_email_failed", "system.backup_download"] } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { action: true, createdAt: true, after: true, user: { select: { name: true } } },
  });
}
