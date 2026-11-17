import type { Db } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { loadActor } from "@/lib/auth/load-actor";
import { todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { appUrl, brandedEmail, mailConfigured, sendMail, type MailMessage } from "@/lib/mail";
import { getDashboardStats } from "./dashboard.service";
import { overdueReport } from "./finance.service";

/**
 * ملخص أسبوعي بالإيميل كل يوم أحد (بتوقيت الرياض) لمن يملك «عرض التقارير» و«عرض المستحقات».
 * الأرقام مقيدة بفروع كل مستخدم (نفس صلاحياته داخل النظام). يُرسل مرة واحدة في اليوم مهما تكررت المهمة.
 */
const SENT_KEY = "digest.weekly_last_sent";

export async function buildDigest(db: Db, actor: Actor): Promise<MailMessage> {
  const [s, overdue] = await Promise.all([getDashboardStats(db, actor), overdueReport(db, actor, {})]);
  const top = overdue
    .slice()
    .sort((a, b) => Number(b.overdue) - Number(a.overdue))
    .slice(0, 5)
    .map((r, i) => `${i + 1}. ${r.tenant} (${r.branch}) — ${formatSAR(r.overdue)} — متأخر ${r.daysLate} يوم`);
  const body = brandedEmail({
    title: "ملخص الأسبوع",
    lines: [
      `صباح الخير ${actor.name}، هذا ملخص فروعك لهذا الأسبوع:`,
      `• نسبة الإشغال: ${s.occupancyPct === null ? "—" : `${s.occupancyPct}%`} (${s.rentedUnits} من ${s.units} وحدة)`,
      `• المحصّل هذا الشهر: ${formatSAR(s.collectedThisMonth)}`,
      `• المستحق حتى اليوم: ${formatSAR(s.dueAmount)}`,
      `• المتأخرات: ${formatSAR(s.overdueAmount)} على ${overdue.length} عقد`,
      `• عقود تنتهي خلال ${s.expiringWithinDays} يوم: ${s.expiringContracts}`,
      ...(top.length ? ["", "أكبر المتأخرين:", ...top] : ["", "ما فيه متأخرات، ما شاء الله 👏"]),
    ],
    button: { label: "افتح المتأخرات", url: appUrl("/finance/overdue") },
    footer: "يوصلك هذا الملخص كل يوم أحد لأن عندك صلاحية عرض التقارير.",
  });
  return { to: actor.email, subject: `ملخص الأسبوع — ZAKI Smart ERP`, ...body };
}

export async function runWeeklyDigest(db: Db, today = todayInRiyadh(), send = sendMail) {
  const out = { sent: 0, failed: 0, skipped: "" };
  if (!mailConfigured() && send === sendMail) return { ...out, skipped: "mail-not-configured" };
  if (new Date(`${today}T00:00:00Z`).getUTCDay() !== 0) return { ...out, skipped: "not-sunday" };
  const last = await db.systemSetting.findUnique({ where: { key: SENT_KEY } });
  if (last?.value === today) return { ...out, skipped: "already-sent" };
  await db.systemSetting.upsert({
    where: { key: SENT_KEY },
    create: { key: SENT_KEY, value: today, description: "آخر يوم أُرسل فيه الملخص الأسبوعي (تلقائي)" },
    update: { value: today },
  });

  const users = await db.user.findMany({
    where: {
      isActive: true,
      AND: [
        { role: { permissions: { some: { permission: { key: "reports.view" } } } } },
        { role: { permissions: { some: { permission: { key: "payments.view" } } } } },
      ],
    },
    select: { id: true },
  });
  for (const u of users) {
    try {
      const actor = await loadActor(db, u.id);
      if (!actor || !actor.permissions.has("dashboard.view")) continue;
      await send(await buildDigest(db, actor));
      out.sent++;
    } catch (e) {
      out.failed++;
      console.error("[weekly-digest]", e instanceof Error ? e.message : e);
    }
  }
  return out;
}
