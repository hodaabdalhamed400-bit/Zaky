import type { Prisma } from "@prisma/client";
import type { Db, Tx } from "@/lib/db";
import type { RequestMeta } from "@/lib/auth/actor";

const REDACT = new Set(["passwordHash", "mfaSecretEnc", "tokenHash", "password", "nationalId"]);

function redact(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => {
      if (REDACT.has(k)) return v == null ? v : "[محجوب]";
      if (typeof v === "bigint") return v.toString();
      return v;
    }),
  );
}

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  branchId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: RequestMeta;
};

export async function writeAudit(db: Db | Tx, input: AuditInput) {
  await db.auditLog.create({
    data: {
      userId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      branchId: input.branchId ?? null,
      before: redact(input.before),
      after: redact(input.after),
      ip: input.meta?.ip?.slice(0, 64) ?? null,
      userAgent: input.meta?.userAgent?.slice(0, 300) ?? null,
    },
  });
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "تسجيل دخول",
  "auth.login_failed": "محاولة دخول فاشلة",
  "auth.logout": "تسجيل خروج",
  "auth.password_changed": "تغيير كلمة المرور",
  "user.create": "إنشاء مستخدم",
  "user.update": "تعديل مستخدم",
  "user.password_reset": "إعادة تعيين كلمة مرور",
  "user.activate": "تفعيل مستخدم",
  "user.deactivate": "تعطيل مستخدم",
  "system.bootstrap_admin": "إنشاء مسؤول النظام الأول",
  "branch.create": "إنشاء فرع",
  "branch.update": "تعديل فرع",
  "branch.status_change": "تغيير حالة فرع",
  "floor.create": "إضافة دور",
  "floor.delete": "حذف دور",
  "unit.create": "إضافة وحدة",
  "unit.update": "تعديل وحدة",
  "unit.status_change": "تغيير حالة وحدة",
  "unit.archive": "أرشفة وحدة",
  "unit.restore": "استعادة وحدة",
  "unit_type.create": "إضافة نوع وحدة",
  "unit_type.activate": "تفعيل نوع وحدة",
  "unit_type.deactivate": "تعطيل نوع وحدة",
  "tenant.create": "إضافة عميل",
  "tenant.update": "تعديل عميل",
  "tenant.archive": "أرشفة عميل",
  "tenant.restore": "استعادة عميل",
  "tenant.contact_add": "إضافة جهة اتصال",
  "tenant.contact_remove": "حذف جهة اتصال",
  "document.upload": "رفع مستند",
  "document.delete": "حذف مستند",
  "document.view_sensitive": "عرض مستند حساس",
  "contract.create": "إنشاء عقد",
  "contract.update": "تعديل مسودة عقد",
  "contract.terms_update": "تعديل شروط عقد",
  "contract.submit": "إرسال عقد للاعتماد",
  "contract.approve": "اعتماد عقد",
  "contract.reject": "إرجاع عقد للتعديل",
  "contract.cancel": "إلغاء عقد",
  "contract.terminate": "إنهاء عقد مبكرًا",
  "contract.renewal_draft": "إنشاء مسودة تجديد",
  "contract.renewal_unlinked": "فك ارتباط تجديد ملغى",
  "contract.expire": "انتهاء عقد",
  "contract.renewed": "انتقال عقد إلى مجدد",
  "payment.record": "تسجيل دفعة",
  "payment.approve": "اعتماد دفعة وإصدار إيصال",
  "payment.reject": "رفض دفعة",
  "payment.reverse": "عكس دفعة",
  "adjustment.create": "تسوية على قسط",
  "report.export": "تصدير تقرير",
  "auth.mfa_enabled": "تفعيل التحقق الثنائي",
  "auth.mfa_failed": "رمز تحقق ثنائي خاطئ",
  "auth.login_recovery_code": "دخول برمز استرداد",
  "user.mfa_reset": "إعادة تعيين التحقق الثنائي",
};
