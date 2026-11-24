import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { formatDateTime } from "@/lib/dates";
import { MIN_PASSPHRASE } from "@/lib/backup";
import { backupEmailStatus, lastBackups } from "@/services/backup.service";
import { Alert, Badge, Card, CardHeader, PageHeader, buttonClass, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "النسخ الاحتياطي" };

const LABEL: Record<string, string> = { "system.backup_email": "نسخة أسبوعية بالإيميل", "system.backup_email_failed": "تعذّر إرسال النسخة", "system.backup_download": "تنزيل يدوي" };

export default async function BackupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const actor = await requirePageActor();
  if (actor.roleKey !== "SUPER_ADMIN") redirect("/forbidden");
  const { error } = await searchParams;
  const st = backupEmailStatus();
  const history = await lastBackups(prisma);
  return (
    <>
      <PageHeader title="النسخ الاحتياطي" description="نسخة كاملة من بيانات النظام خارج الاستضافة — حتى لو حصل أي طارئ في الخادم أو الحساب، تُسترجع البيانات كاملة." />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="تنزيل نسخة الآن" />
          <form method="post" action="/api/backup" className="space-y-4 p-5" data-backup-form>
            <p className="text-sm text-gray-600">ملف مشفّر فيه كل البيانات (الفروع، الوحدات، العملاء، العقود، الأقساط، المدفوعات، المشتريات، المستخدمين، سجل التدقيق). احفظه في مكان آمن خارج الجهاز (Google Drive أو فلاشة).</p>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">كلمة سر النسخة ({MIN_PASSPHRASE} حرفًا على الأقل)</span>
              <input name="passphrase" type="password" required minLength={MIN_PASSPHRASE} autoComplete="new-password" className={inputClass} />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-800">تأكيد كلمة السر</span>
              <input name="confirm" type="password" required minLength={MIN_PASSPHRASE} autoComplete="new-password" className={inputClass} />
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="files" value="1" defaultChecked className="size-4 rounded" />
              تضمين الملفات المرفوعة (العقود والمستندات وصور الفواتير)
            </label>
            <Alert kind="warning">احفظ كلمة السر في مكان آمن — بدونها لا يمكن فتح النسخة أبدًا، ولا يمكن استرجاعها.</Alert>
            <button type="submit" className={buttonClass("primary")}>تنزيل النسخة</button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="النسخة الأسبوعية التلقائية" />
            <div className="space-y-3 p-5 text-sm">
              {st.ready ? (
                <Alert kind="success">مفعّلة — تُرسل نسخة مشفّرة كل أسبوع إلى {st.recipients} بريد.</Alert>
              ) : (
                <Alert kind="info">غير مفعّلة بعد. تحتاج ضبط هذه الإعدادات في خادم Render (Environment):</Alert>
              )}
              <ul className="space-y-1.5">
                <li className="flex items-center justify-between"><span>إعداد البريد (SMTP_HOST وSMTP_USER وSMTP_PASS وMAIL_FROM)</span>{st.mail ? <Badge color="green">جاهز</Badge> : <Badge color="amber">ناقص</Badge>}</li>
                <li className="flex items-center justify-between"><span>كلمة سر التشفير BACKUP_PASSPHRASE</span>{st.passphrase ? <Badge color="green">جاهز</Badge> : <Badge color="amber">ناقص</Badge>}</li>
                <li className="flex items-center justify-between"><span>البريد المستلم BACKUP_EMAIL</span>{st.recipients ? <Badge color="green">{st.recipients} بريد</Badge> : <Badge color="amber">ناقص</Badge>}</li>
              </ul>
            </div>
          </Card>
          <Card>
            <CardHeader title="آخر النسخ" />
            {history.length === 0 ? (
              <p className="p-5 text-sm text-gray-500">لا توجد نسخ بعد.</p>
            ) : (
              <ul className="divide-y divide-gray-100 text-sm">
                {history.map((h, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>{LABEL[h.action] ?? h.action}{h.user ? ` — ${h.user.name}` : ""}</span>
                    <span className="tabular text-xs text-gray-500">{formatDateTime(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
