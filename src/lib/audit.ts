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
};
