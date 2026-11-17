"use client";
import { useState } from "react";

/** زر الوضع الليلي: يبدّل الكلاس على منطقة المحتوى ويحفظ الاختيار في كوكي (سنة). */
export function ThemeToggle({ initial, dark: onDarkBg = false }: { initial: "light" | "dark"; dark?: boolean }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        // الحالة الفعلية من الصفحة (يوجد زران: للجوال وللشاشة الكبيرة)
        const main = document.getElementById("main");
        const to = main?.classList.contains("theme-dark") ? "light" : "dark";
        main?.classList.toggle("theme-dark", to === "dark");
        document.cookie = `theme=${to}; path=/; max-age=31536000; samesite=lax`;
        setTheme(to);
      }}
      aria-label={next === "dark" ? "تفعيل الوضع الليلي" : "تفعيل الوضع النهاري"}
      title={next === "dark" ? "الوضع الليلي" : "الوضع النهاري"}
      className={`inline-flex items-center rounded-xl p-2 transition-colors ${onDarkBg ? "text-white hover:bg-white/10" : "text-gray-600 ring-1 ring-gray-200 hover:bg-accent-50 hover:text-brand-900 hover:ring-accent-500/40"}`}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="size-5" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  );
}
