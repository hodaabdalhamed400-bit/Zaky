"use client";
import { useEffect, useRef, useState } from "react";

/**
 * عدّاد متحرك للأرقام المعروضة (مثل "1,250.00 ر.س" أو "75%").
 * النص الحقيقي يبقى دائمًا في الصفحة (لقارئات الشاشة والنسخ والاختبارات)،
 * والرقم المتحرك طبقة شكلية فوقه فقط، ويُلغى مع «تقليل الحركة».
 */
const NUM = /\d[\d,]*(?:\.\d+)?/;

export function CountUp({ value, duration = 1100 }: { value: string; duration?: number }) {
  const [shown, setShown] = useState<string | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    const m = value.match(NUM);
    if (!m || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = Number(m[0].replace(/,/g, ""));
    if (!Number.isFinite(target) || target === 0) return;
    const decimals = m[0].split(".")[1]?.length ?? 0;
    const grouped = m[0].includes(",") || target >= 1000;
    const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      if (p >= 1) return setShown(null);
      setShown(value.replace(m[0], fmt.format(target * eased)));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);

  return (
    <span className="relative inline-block">
      <span className={shown === null ? undefined : "text-transparent"}>{value}</span>
      {shown !== null && (
        // الرقم المتحرك عبر ::after فقط، فلا يدخل في نص الصفحة
        <span className="absolute inset-0 whitespace-nowrap after:content-[attr(data-v)]" data-v={shown} aria-hidden="true" />
      )}
    </span>
  );
}
