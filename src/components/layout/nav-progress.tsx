"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * شريط تقدّم متحرك أعلى الصفحة أثناء التنقل بين الصفحات.
 * يبدأ عند الضغط على رابط داخلي أو إرسال نموذج بحث (GET)، وينتهي عند تغيّر العنوان.
 */
export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [active, setActive] = useState(false);

  useEffect(() => setActive(false), [pathname, search]);

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setActive(false), 12000);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    const here = () => window.location.pathname + window.location.search;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api") || url.pathname.startsWith("/print")) return;
      if (url.pathname + url.search !== here()) setActive(true);
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement;
      if (!e.defaultPrevented && f.method.toLowerCase() === "get" && !f.target) setActive(true);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" role="progressbar" aria-label="جارٍ تحميل الصفحة">
      <div className="h-full w-full origin-right animate-[nav-progress_8s_cubic-bezier(0.1,0.7,0.2,1)_forwards] bg-gradient-to-l from-accent-500 via-[#2a78d6] to-accent-300 shadow-[0_0_10px_var(--color-accent-500)]" />
    </div>
  );
}
