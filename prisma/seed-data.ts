import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_KEYS } from "../src/lib/rbac/permissions";

/**
 * الفروع الأولية كما وردت من الشركة. المدينة/العنوان/المدير تُستكمل من شاشة الفروع
 * (المرحلة الثانية) بعد تأكيدها — لا نفترض بيانات غير مؤكدة.
 */
export const INITIAL_BRANCHES = [
  { code: "GRN", nameAr: "غرناطة مول" },
  { code: "LVL", nameAr: "لافالي مول" },
  { code: "RWD", nameAr: "الروضة" },
  { code: "IZD", nameAr: "الازدهار" },
  { code: "QSR", nameAr: "القصر مول" },
  { code: "UNV", nameAr: "بهو الجامعة" },
  { code: "TBK", nameAr: "تبوك" },
];

export const UNIT_TYPES = [
  { key: "PRIVATE_OFFICE", nameAr: "مكتب خاص", occupancyMode: "EXCLUSIVE" as const },
  { key: "SHARED_OFFICE", nameAr: "مكتب مشترك", occupancyMode: "SHARED" as const },
  { key: "MEETING_ROOM", nameAr: "قاعة اجتماعات", occupancyMode: "EXCLUSIVE" as const },
  { key: "ADMIN_SPACE", nameAr: "مساحة إدارية", occupancyMode: "EXCLUSIVE" as const },
];

export const DEFAULT_SETTINGS = [
  { key: "contract.expiry_alert_days", value: [30, 15, 7], description: "أيام التنبيه قبل انتهاء العقد" },
  { key: "finance.vat_rate", value: "0.15", description: "نسبة ضريبة القيمة المضافة الافتراضية (تحتاج تأكيد انطباقها)" },
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
    await db.branch.upsert({ where: { code: b.code }, create: b, update: {} });
  }
  for (const t of UNIT_TYPES) {
    await db.unitType.upsert({ where: { key: t.key }, create: { ...t, isSystem: true }, update: {} });
  }
  for (const s of DEFAULT_SETTINGS) {
    await db.systemSetting.upsert({ where: { key: s.key }, create: s, update: {} });
  }
}
