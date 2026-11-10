import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_KEYS } from "../src/lib/rbac/permissions";

/** الرقم الموحد لجميع الفروع (رقم الشركة) — معتمد من الإدارة. */
export const COMPANY_PHONE = "0500510051";

type BranchSeed = {
  code: string;
  nameAr: string;
  city: string | null;
  managerName: string | null;
  managerActing: boolean;
  status: "ACTIVE" | "PREPARING";
  notes?: string;
};

/**
 * الفروع كما اعتمدتها الإدارة (نوفمبر 2026).
 * - المدينة: جميع الفروع في الرياض عدا فرع تبوك (مؤكد من الإدارة).
 * - "القصر مول" هو فرع السويدي، و"بهو الجامعة" هو فرع جامعة الإمام (مؤكد).
 * - العنوان ورابط الخريطة تُستكمل من شاشة الفروع (المرحلة الثانية).
 * ملاحظة: الزرع لا يعدّل فرعًا موجودًا (update: {}) حتى لا يمسح تعديلات الإدارة لاحقًا.
 */
export const INITIAL_BRANCHES: BranchSeed[] = [
  // فروع عاملة
  { code: "IZD", nameAr: "الازدهار", city: "الرياض", managerName: "أسماء", managerActing: false, status: "ACTIVE" },
  { code: "NFL", nameAr: "النفل", city: "الرياض", managerName: "حنان", managerActing: false, status: "ACTIVE" },
  { code: "IMU", nameAr: "جامعة الإمام", city: "الرياض", managerName: "حنان", managerActing: true, status: "ACTIVE", notes: "يُعرف سابقًا باسم: بهو الجامعة" },
  { code: "MRK", nameAr: "المركز", city: "الرياض", managerName: "حنان", managerActing: true, status: "ACTIVE" },
  { code: "RWD", nameAr: "الروضة", city: "الرياض", managerName: "أحمد", managerActing: true, status: "ACTIVE" },
  { code: "SWD", nameAr: "السويدي", city: "الرياض", managerName: "هاجر", managerActing: false, status: "ACTIVE", notes: "يُعرف سابقًا باسم: القصر مول" },
  { code: "TBK", nameAr: "تبوك", city: "تبوك", managerName: "عبد الرحمن", managerActing: false, status: "ACTIVE" },
  // قيد التجهيز (الافتتاح خلال شهر تقريبًا) — بدون مدير بعد
  { code: "GRN", nameAr: "غرناطة مول", city: "الرياض", managerName: null, managerActing: false, status: "PREPARING" },
  { code: "LV2", nameAr: "لافالي 2", city: "الرياض", managerName: null, managerActing: false, status: "PREPARING" },
  { code: "HTN", nameAr: "حطين", city: "الرياض", managerName: null, managerActing: false, status: "PREPARING" },
  { code: "MLQ", nameAr: "الملقا", city: "الرياض", managerName: null, managerActing: false, status: "PREPARING" },
];

export const UNIT_TYPES = [
  { key: "PRIVATE_OFFICE", nameAr: "مكتب خاص", occupancyMode: "EXCLUSIVE" as const },
  { key: "SHARED_OFFICE", nameAr: "مكتب مشترك", occupancyMode: "SHARED" as const },
  // قاعات الاجتماعات: حجوزات منفصلة بالساعة/اليوم بدون عقود (قرار معتمد)
  { key: "MEETING_ROOM", nameAr: "قاعة اجتماعات", occupancyMode: "EXCLUSIVE" as const, leaseMode: "BOOKING" as const },
  { key: "ADMIN_SPACE", nameAr: "مساحة إدارية", occupancyMode: "EXCLUSIVE" as const },
];

export const DEFAULT_SETTINGS = [
  { key: "contract.expiry_alert_days", value: [30, 15, 7], description: "أيام التنبيه قبل انتهاء العقد" },
  { key: "finance.vat_rate", value: "0.15", description: "نسبة ضريبة القيمة المضافة — الإيجار خاضع للضريبة (معتمد)" },
  { key: "finance.prices_include_vat", value: true, description: "الأسعار والإيجارات المدخلة شاملة الضريبة (معتمد)" },
  { key: "finance.grace_days", value: 0, description: "لا توجد مهلة سماح: القسط غير المسدد بنهاية يوم استحقاقه متأخر (معتمد)" },
  { key: "finance.installment_due_rule", value: "SAME_DAY_AS_CONTRACT_START", description: "القسط يستحق في نفس يوم بداية العقد من كل شهر (معتمد)" },
  { key: "finance.allocation_mode", value: "MANUAL", description: "توزيع الدفعة على الأقساط يختاره الموظف (معتمد)" },
  { key: "finance.overpayment_allowed", value: false, description: "لا يوجد دفع زائد: الدفعة توزع بالكامل على أقساط مستحقة (معتمد)" },
  { key: "finance.late_fees_enabled", value: false, description: "لا توجد رسوم تأخير (معتمد)" },
  { key: "finance.receipt_number_format", value: "RC-{BRANCH}-{YEAR}-{SEQ5}", description: "ترقيم الإيصالات: تسلسل مستقل لكل فرع (معتمد)" },
  { key: "security.mfa_required_roles", value: ["SUPER_ADMIN", "GENERAL_MANAGER"], description: "أدوار يُفرض عليها التحقق الثنائي (عند تفعيل الفرض MFA_ENFORCE)" },
  { key: "company.phone", value: COMPANY_PHONE, description: "رقم التواصل الموحد للشركة والفروع" },
  { key: "contract.number_format", value: "ZK-{BRANCH}-{YEAR}-{SEQ4}", description: "ترقيم العقود، مثال ZK-IZD-2026-0001 (معتمد)" },
  { key: "contract.deposits_enabled", value: false, description: "لا يوجد تأمين في عقود ذكي (معتمد)" },
  { key: "contract.early_exit_refund", value: false, description: "عند الخروج المبكر لا يُسترد باقي قيمة العقد (معتمد)" },
  { key: "contract.renewal_draft_days", value: 30, description: "إنشاء مسودة التجديد تلقائيًا قبل انتهاء العقد بهذا العدد من الأيام (معتمد)" },
  { key: "contract.renewal_pricing", value: "NEGOTIATED", description: "سعر التجديد حسب الاتفاق مع مسؤول الفرع (معتمد)" },
  { key: "finance.currency", value: "SAR", description: "العملة" },
  { key: "system.timezone", value: "Asia/Riyadh", description: "المنطقة الزمنية" },
];

/** مزامنة غير هدامة (idempotent): تنشئ المفقود وتحدّث تعريفات الأدوار النظامية. */
export async function seedReferenceData(db: PrismaClient) {
  for (const [key, def] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({
      where: { key },
      create: { key, nameAr: def.nameAr, groupAr: def.groupAr },
      update: { nameAr: def.nameAr, groupAr: def.groupAr },
    });
  }
  const perms = await db.permission.findMany();
  const permId = new Map(perms.map((p) => [p.key, p.id]));

  for (const key of ROLE_KEYS) {
    const def = ROLE_DEFINITIONS[key];
    const role = await db.role.upsert({
      where: { key },
      create: { key, nameAr: def.nameAr, description: def.description, isSystem: true, allBranches: def.allBranches },
      update: { nameAr: def.nameAr, description: def.description, allBranches: def.allBranches, isSystem: true },
    });
    await db.$transaction([
      db.rolePermission.deleteMany({ where: { roleId: role.id } }),
      db.rolePermission.createMany({
        data: def.permissions.map((p) => ({ roleId: role.id, permissionId: permId.get(p)! })),
      }),
    ]);
  }

  for (const b of INITIAL_BRANCHES) {
    await db.branch.upsert({ where: { code: b.code }, create: { ...b, phone: COMPANY_PHONE }, update: {} });
  }
  for (const t of UNIT_TYPES) {
    await db.unitType.upsert({ where: { key: t.key }, create: { ...t, isSystem: true }, update: {} });
  }
  for (const s of DEFAULT_SETTINGS) {
    await db.systemSetting.upsert({ where: { key: s.key }, create: s, update: {} });
  }
}
