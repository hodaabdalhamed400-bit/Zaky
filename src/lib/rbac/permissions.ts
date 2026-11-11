/**
 * تعريف الصلاحيات والأدوار — المصدر الوحيد للحقيقة.
 * يتم مزامنتها مع قاعدة البيانات عبر prisma/seed.ts.
 * التحقق الفعلي يتم دائمًا على الخادم (src/lib/rbac/guard.ts).
 */

export const PERMISSIONS = {
  "dashboard.view": { nameAr: "عرض لوحة التحكم", groupAr: "لوحة التحكم" },

  "branches.view": { nameAr: "عرض الفروع", groupAr: "الفروع" },
  "branches.manage": { nameAr: "إضافة وتعديل وإيقاف الفروع", groupAr: "الفروع" },

  "units.view": { nameAr: "عرض الوحدات", groupAr: "الوحدات" },
  "units.manage": { nameAr: "إضافة وتعديل الوحدات", groupAr: "الوحدات" },

  "tenants.view": { nameAr: "عرض المستأجرين", groupAr: "المستأجرون" },
  "tenants.manage": { nameAr: "إضافة وتعديل المستأجرين", groupAr: "المستأجرون" },
  "tenants.view_sensitive": { nameAr: "عرض الهوية والبيانات الحساسة", groupAr: "المستأجرون" },

  "contracts.view": { nameAr: "عرض العقود", groupAr: "العقود" },
  "contracts.create": { nameAr: "إنشاء مسودة عقد", groupAr: "العقود" },
  "contracts.edit": { nameAr: "تعديل العقود", groupAr: "العقود" },
  "contracts.approve": { nameAr: "اعتماد العقود", groupAr: "العقود" },
  "contracts.terminate": { nameAr: "إنهاء وإلغاء العقود", groupAr: "العقود" },

  "payments.view": { nameAr: "عرض المستحقات والمدفوعات", groupAr: "المالية" },
  "payments.record": { nameAr: "تسجيل دفعة", groupAr: "المالية" },
  "payments.approve": { nameAr: "اعتماد التحصيل وإصدار الإيصال", groupAr: "المالية" },
  "payments.refund": { nameAr: "الاستردادات والتأمينات", groupAr: "المالية" },
  "finance.adjust": { nameAr: "التسويات والخصومات", groupAr: "المالية" },

  "documents.view": { nameAr: "عرض المستندات العادية", groupAr: "المستندات" },
  "documents.upload": { nameAr: "رفع المستندات", groupAr: "المستندات" },
  "documents.view_sensitive": { nameAr: "عرض المستندات الحساسة", groupAr: "المستندات" },

  "bookings.view": { nameAr: "عرض حجوزات القاعات", groupAr: "حجوزات القاعات" },
  "bookings.manage": { nameAr: "إنشاء وإلغاء حجوزات القاعات", groupAr: "حجوزات القاعات" },

  "purchases.view": { nameAr: "عرض فواتير الشراء", groupAr: "المشتريات" },
  "purchases.create": { nameAr: "إضافة فواتير الشراء", groupAr: "المشتريات" },
  "purchases.approve": { nameAr: "اعتماد فواتير الشراء والدفع والتصنيفات", groupAr: "المشتريات" },

  "reports.view": { nameAr: "عرض التقارير", groupAr: "التقارير" },
  "reports.export": { nameAr: "تصدير التقارير", groupAr: "التقارير" },

  "users.view": { nameAr: "عرض المستخدمين", groupAr: "الإدارة" },
  "users.manage": { nameAr: "إدارة المستخدمين", groupAr: "الإدارة" },
  "roles.view": { nameAr: "عرض الأدوار والصلاحيات", groupAr: "الإدارة" },
  "audit.view": { nameAr: "عرض سجل التدقيق", groupAr: "الإدارة" },
  "settings.manage": { nameAr: "إعدادات النظام", groupAr: "الإدارة" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

export const ROLE_KEYS = [
  "SUPER_ADMIN",
  "GENERAL_MANAGER",
  "ACCOUNTANT",
  "BRANCH_MANAGER",
  "SALES_EMPLOYEE",
  "OPERATIONS_EMPLOYEE",
  "READ_ONLY",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

type RoleDef = {
  nameAr: string;
  description: string;
  allBranches: boolean;
  permissions: PermissionKey[];
};

const VIEW_BASICS: PermissionKey[] = [
  "dashboard.view",
  "branches.view",
  "units.view",
  "tenants.view",
  "contracts.view",
  "documents.view",
  "bookings.view",
];

/**
 * الصلاحيات الافتراضية لكل دور — اعتمدتها الإدارة (نوفمبر 2026)،
 * مع منح مدير الفرع اعتماد العقود والتحصيل. راجع docs/BUSINESS_RULES.md.
 */
export const ROLE_DEFINITIONS: Record<RoleKey, RoleDef> = {
  SUPER_ADMIN: {
    nameAr: "مسؤول النظام",
    description: "صلاحيات كاملة على النظام وجميع الفروع",
    allBranches: true,
    permissions: [...ALL_PERMISSIONS],
  },
  GENERAL_MANAGER: {
    nameAr: "الإدارة العليا",
    description: "اطلاع واعتماد على جميع الفروع، دون إعدادات النظام",
    allBranches: true,
    permissions: ALL_PERMISSIONS.filter((p) => p !== "settings.manage"),
  },
  ACCOUNTANT: {
    nameAr: "المحاسب",
    description: "التحصيل والاعتماد المالي والتقارير للفروع المخصصة",
    allBranches: false,
    permissions: [
      ...VIEW_BASICS,
      "tenants.view_sensitive",
      "payments.view",
      "payments.record",
      "payments.approve",
      "payments.refund",
      "finance.adjust",
      "purchases.view",
      "purchases.create",
      "purchases.approve",
      "documents.upload",
      "documents.view_sensitive",
      "reports.view",
      "reports.export",
    ],
  },
  BRANCH_MANAGER: {
    nameAr: "مدير الفرع",
    // معتمد من الإدارة: مسؤول الفرع هو من يعتمد العقود والتحصيل في فرعه
    description: "إدارة الوحدات والمستأجرين والعقود واعتماد العقود والتحصيل في فروعه فقط",
    allBranches: false,
    permissions: [
      ...VIEW_BASICS,
      "units.manage",
      "tenants.manage",
      "tenants.view_sensitive",
      "contracts.create",
      "contracts.edit",
      "contracts.approve",
      "bookings.manage",
      "payments.view",
      "payments.record",
      "payments.approve",
      "purchases.view",
      "purchases.create",
      "documents.upload",
      "documents.view_sensitive",
      "reports.view",
      "reports.export",
    ],
  },
  SALES_EMPLOYEE: {
    nameAr: "موظف المبيعات",
    description: "العملاء المحتملون ومسودات العقود في فروعه",
    allBranches: false,
    permissions: [...VIEW_BASICS, "tenants.manage", "contracts.create", "documents.upload", "bookings.manage"],
  },
  OPERATIONS_EMPLOYEE: {
    nameAr: "موظف التشغيل",
    description: "حالة الوحدات والتشغيل اليومي في فروعه",
    allBranches: false,
    permissions: [...VIEW_BASICS, "units.manage", "documents.upload", "bookings.manage"],
  },
  READ_ONLY: {
    nameAr: "اطلاع فقط",
    description: "عرض البيانات غير الحساسة للفروع المخصصة دون أي تعديل",
    allBranches: false,
    permissions: [...VIEW_BASICS, "payments.view", "reports.view"],
  },
};
