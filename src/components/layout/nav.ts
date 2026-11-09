import type { IconName } from "@/components/ui/icons";
import type { PermissionKey } from "@/lib/rbac/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  perm: PermissionKey;
  /** إن وُجد: القسم غير مفعّل بعد ويظهر معطلًا مع رقم المرحلة */
  phase?: number;
};

export const NAV: { title?: string; items: NavItem[] }[] = [
  { items: [{ href: "/", label: "لوحة التحكم", icon: "dashboard", perm: "dashboard.view" }] },
  {
    title: "العقارات",
    items: [
      { href: "/branches", label: "الفروع", icon: "branches", perm: "branches.view" },
      { href: "/units", label: "المكاتب والوحدات", icon: "units", perm: "units.view", phase: 2 },
    ],
  },
  {
    title: "التأجير",
    items: [
      { href: "/tenants", label: "المستأجرون", icon: "tenants", perm: "tenants.view", phase: 3 },
      { href: "/contracts", label: "العقود", icon: "contracts", perm: "contracts.view", phase: 3 },
    ],
  },
  {
    title: "المالية",
    items: [
      { href: "/finance", label: "التحصيل والمستحقات", icon: "finance", perm: "payments.view", phase: 4 },
      { href: "/reports", label: "التقارير", icon: "reports", perm: "reports.view", phase: 5 },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { href: "/users", label: "المستخدمون", icon: "users", perm: "users.view" },
      { href: "/roles", label: "الأدوار والصلاحيات", icon: "shield", perm: "roles.view" },
      { href: "/audit", label: "سجل التدقيق", icon: "audit", perm: "audit.view" },
    ],
  },
];
