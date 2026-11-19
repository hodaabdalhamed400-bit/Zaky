import type { SceneTone } from "@/services/branch-scene.service";

/** ألوان الحالات — نفس ألوان النظام، والحالة مكتوبة دائمًا في البطاقة (لا تعتمد على اللون وحده) */
export const TONE: Record<SceneTone, { color: string; label: string }> = {
  available: { color: "#10b981", label: "متاحة" },
  rented: { color: "#2a78d6", label: "مؤجرة" },
  partial: { color: "#1eadc0", label: "مؤجرة جزئيًا" },
  expiring: { color: "#f59e0b", label: "تنتهي خلال 30 يومًا" },
  reserved: { color: "#eab308", label: "محجوزة" },
  maintenance: { color: "#ef4444", label: "صيانة" },
  inactive: { color: "#94a3b8", label: "غير نشطة" },
};

