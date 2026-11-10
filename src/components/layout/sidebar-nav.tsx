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
    <nav aria-label="القائمة الرئيسية" className="space-y-5">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <p className="mb-1.5 px-3 text-xs font-semibold text-accent-300/80">{s.title}</p>}
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
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-white/10 font-semibold text-white shadow-[inset_-3px_0_0_var(--color-accent-500)]"
                        : "text-brand-50/85 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    <Icon name={item.icon} className="size-4.5" />
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
    <div className="px-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- SVG ثابت */}
      <img src="/brand/zaki-logo-white.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={168} height={64} className="h-14 w-auto" />
      <p className="mt-1.5 text-[11px] font-medium tracking-wide text-accent-300">ZAKI Smart ERP</p>
    </div>
  );

  return (
    <>
      {/* شريط علوي للجوال */}
      <div className="sticky top-0 z-30 flex items-center justify-between bg-brand-900 px-4 py-2.5 lg:hidden">
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
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 start-0 flex w-72 flex-col overflow-y-auto bg-brand-900 py-4">
            <div className="flex items-center justify-between pe-3">
              {brand}
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-white hover:bg-white/10" aria-label="إغلاق القائمة">
                <Icon name="close" />
              </button>
            </div>
            <div className="mt-6 flex-1 px-3">
              <NavLinks sections={sections} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-white/10 px-3 pt-3">{footer}</div>
          </aside>
        </div>
      )}

      {/* القائمة الثابتة لسطح المكتب */}
      <aside className="fixed inset-y-0 start-0 hidden w-64 flex-col overflow-y-auto bg-brand-900 py-5 lg:flex">
        {brand}
        <div className="mt-7 flex-1 px-3">
          <NavLinks sections={sections} />
        </div>
        <div className="border-t border-white/10 px-3 pt-3">{footer}</div>
      </aside>
    </>
  );
}
