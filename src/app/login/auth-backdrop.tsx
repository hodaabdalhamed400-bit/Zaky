"use client";
import { useEffect, useRef } from "react";

/**
 * خلفية صفحات الدخول التفاعلية: توهج يتبع المؤشر وحركة خفيفة (parallax) للهالات.
 * شكلية فقط، وتتوقف مع «تقليل الحركة» وعلى شاشات اللمس.
 */
export function AuthBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || window.matchMedia("(pointer: coarse)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = e.clientX / window.innerWidth;
        const y = e.clientY / window.innerHeight;
        el.style.setProperty("--mx", `${e.clientX}px`);
        el.style.setProperty("--my", `${e.clientY}px`);
        el.style.setProperty("--px", `${(x - 0.5) * 40}px`);
        el.style.setProperty("--py", `${(y - 0.5) * 40}px`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 [--mx:50vw] [--my:40vh] [--px:0px] [--py:0px]" aria-hidden="true">
      {/* هالات ملونة تتحرك ببطء وتميل مع المؤشر */}
      <div className="absolute inset-0 transition-transform duration-700 ease-out [transform:translate(var(--px),var(--py))]">
        <div className="absolute -top-40 -start-32 size-[34rem] animate-drift rounded-full bg-accent-500/30 blur-3xl" />
        <div className="absolute -bottom-48 -end-24 size-[36rem] animate-drift-slow rounded-full bg-[#2a78d6]/25 blur-3xl" />
      </div>
      <div className="absolute inset-0 transition-transform duration-1000 ease-out [transform:translate(calc(var(--px)*-0.6),calc(var(--py)*-0.6))]">
        <div className="absolute end-[18%] top-[12%] size-72 animate-drift rounded-full bg-emerald-400/10 blur-3xl [animation-duration:22s]" />
      </div>
      {/* توهج يتبع المؤشر */}
      <div className="absolute inset-0 bg-[radial-gradient(600px_circle_at_var(--mx)_var(--my),rgb(30_173_192/0.14),transparent_60%)]" />
    </div>
  );
}
