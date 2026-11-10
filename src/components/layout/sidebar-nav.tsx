"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/components/ui/primitives";
import type { NavItem } from "./nav";

type Section = { title?: string; items: NavItem[] };

function NavLinks({ sections, onNavigate }: { sections: Section[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="القائمة الرئيسية" className="space-y-4">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <p className="mb-2 flex items-center gap-2 px-3 text-[11px] font-semibold tracking-wide text-accent-300/80"><span className="h-px w-3 bg-accent-300/50" aria-hidden="true" />{s.title}</p>}
          <ul className="space-y-0.5">
            {s.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              if (item.phase)
                return (
                  <li key={item.href}>
                    <span
                      className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-100/45"
                      title={`سيتم تفعيله في المرحلة ${item.phase}`}
                      aria-disabled="true"
                    >
                      <Icon name={item.icon} className="size-4.5" />
                      <span className="flex-1">{item.label}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px]">م{item.phase}</span>
                    </span>
                  </li>
                );
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "group relative flex items-center gap-3 rounded-xl px-3 py-1.5 text-sm transition-all duration-200",
                      active
                        ? "bg-gradient-to-l from-accent-500/25 to-white/5 font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
                        : "text-brand-50/80 hover:-translate-x-1 hover:bg-white/[0.07] hover:text-white",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 start-0 w-1 animate-scale-in rounded-full bg-accent-500 shadow-[0_0_12px_var(--color-accent-500)]" aria-hidden="true" />}
                    <span
                      className={cx(
                        "grid size-7 shrink-0 place-items-center rounded-lg transition-all duration-200",
                        active ? "bg-accent-500 text-white shadow-lg shadow-accent-500/40" : "bg-white/[0.06] text-brand-100 group-hover:bg-white/15 group-hover:text-white",
                      )}
                    >
                      <Icon name={item.icon} className="size-4" />
                    </span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SidebarNav({ sections, footer, topAction }: { sections: Section[]; footer: React.ReactNode; topAction?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  const brand = (
    <div className="px-4">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG ثابت */}
      <img src="/brand/zaki-logo-white.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={168} height={64} className="h-14 w-auto drop-shadow-[0_4px_18px_rgb(30_173_192/0.25)]" />
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-accent-300 ring-1 ring-white/10">
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping-soft rounded-full bg-accent-500" />
          <span className="relative inline-flex size-1.5 rounded-full bg-accent-500" />
        </span>
        ZAKI SMART ERP
      </p>
    </div>
  );

  return (
    <>
      {/* شريط علوي للجوال */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-gradient-to-l from-brand-900 to-[#0e2640] px-4 py-2.5 shadow-lg shadow-brand-900/20 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/zaki-logo-white.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={126} height={48} className="h-10 w-auto" />
        <div className="flex items-center gap-1">
        {topAction}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg p-2 text-white hover:bg-white/10"
          aria-label="فتح القائمة"
          aria-expanded={open}
          aria-controls="mobile-sidebar"
        >
          <Icon name="menu" />
        </button>
        </div>
      </div>

      {/* قائمة الجوال المنزلقة */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" id="mobile-sidebar">
          <div className="absolute inset-0 animate-fade-in bg-brand-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="scroll-thin absolute inset-y-0 start-0 flex w-72 animate-slide-in-start flex-col overflow-y-auto bg-gradient-to-b from-brand-900 to-[#0b2036] py-4 shadow-2xl">
            <div className="flex items-center justify-between pe-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-white hover:bg-white/10" aria-label="إغلاق القائمة">
                <Icon name="close" />
              </button>
            </div>
            <div className="mt-6 flex-1 px-3">
              <NavLinks sections={sections} onNavigate={() => setOpen(false)} />
            </div>
            <div className="relative mx-3 mt-4 rounded-2xl bg-white/[0.05] p-1.5 ring-1 ring-white/10">{footer}</div>
          </aside>
        </div>
      )}

      {/* القائمة الثابتة لسطح المكتب */}
      <aside className="scroll-thin fixed inset-y-0 start-0 z-30 hidden w-64 flex-col overflow-y-auto bg-gradient-to-b from-brand-900 via-brand-900 to-[#0b2036] py-5 lg:flex">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="bg-grid absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_45%)]" />
          <div className="absolute -top-24 -end-24 size-64 animate-drift rounded-full bg-accent-500/20 blur-3xl" />
          <div className="absolute bottom-10 -start-20 size-56 animate-drift-slow rounded-full bg-[#2a78d6]/15 blur-3xl" />
        </div>
        <div className="relative">{brand}</div>
        <div className="relative mt-5 flex-1 px-3">
          <NavLinks sections={sections} />
        </div>
        <div className="relative mx-3 mt-4 rounded-2xl bg-white/[0.05] p-1.5 ring-1 ring-white/10">{footer}</div>
      </aside>
    </>
  );
}
