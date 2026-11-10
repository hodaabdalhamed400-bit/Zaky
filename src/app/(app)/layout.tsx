import Link from "next/link";
import { Suspense } from "react";
import { NavProgress } from "@/components/layout/nav-progress";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/server";
import { NAV } from "@/components/layout/nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Icon } from "@/components/ui/icons";
import { logoutAction } from "../actions";
import { prisma } from "@/lib/db";
import { unreadCount } from "@/services/notifications.service";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  // القائمة تعرض فقط ما يملك المستخدم صلاحيته (والتحقق الحقيقي يتم في كل صفحة/إجراء)
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => actor.permissions.has(i.perm)) })).filter(
    (s) => s.items.length > 0,
  );

  const unread = await unreadCount(prisma, actor);
  const today = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Riyadh",
  }).format(new Date());
  const bell = (dark: boolean) => (
    <Link
      href="/notifications"
      className={`group relative inline-flex items-center gap-2 rounded-xl p-2 text-sm transition-colors ${dark ? "text-white hover:bg-white/10" : "text-gray-600 ring-1 ring-gray-200 hover:bg-accent-50 hover:text-brand-900 hover:ring-accent-500/40"}`}
      aria-label={unread ? `الإشعارات: ${unread} غير مقروء` : "الإشعارات"}
    >
      <span className={unread > 0 ? "inline-block origin-top group-hover:animate-[bell-ring_0.8s_ease-in-out]" : undefined}>
        <Icon name="bell" />
      </span>
      {unread > 0 && (
        <span className="absolute -top-1 -end-1 grid">
          <span className="col-start-1 row-start-1 animate-ping-soft rounded-full bg-red-500" aria-hidden="true" />
          <span className="tabular col-start-1 row-start-1 grid min-w-5 place-items-center rounded-full bg-gradient-to-b from-red-500 to-red-700 px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-white">
            {unread > 99 ? "99+" : unread}
          </span>
        </span>
      )}
    </Link>
  );

  const footer = (
    <div className="space-y-1">
      <Link href="/account" className="flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm text-brand-50/85 transition-colors hover:bg-white/10 hover:text-white">
        <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-accent-500 to-[#2a78d6] text-sm font-bold text-white shadow-lg shadow-accent-500/30 ring-2 ring-white/20">
          {actor.name.trim().charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-white">{actor.name}</span>
          <span className="block truncate text-xs text-brand-100/70">{actor.roleNameAr}</span>
        </span>
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-brand-50/75 transition-colors hover:bg-red-500/15 hover:text-red-100">
          <Icon name="logout" className="size-4.5" />
          تسجيل الخروج
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:p-2">
        تخطَّ إلى المحتوى
      </a>
      <Suspense fallback={null}>
        <NavProgress />
      </Suspense>
      <SidebarNav sections={sections} footer={footer} topAction={bell(true)} />
      <main id="main" className="relative lg:ps-64">
        <div className="bg-dots pointer-events-none absolute inset-x-0 top-0 h-72 [mask-image:linear-gradient(to_bottom,black,transparent)]" aria-hidden="true" />
        <div className="sticky top-0 z-20 hidden items-center justify-between gap-4 border-b border-gray-200/70 bg-white/75 px-8 py-2.5 backdrop-blur-xl lg:flex">
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <Icon name="calendar" className="size-4 text-accent-600" />
            <span className="tabular">{today}</span>
          </p>
          <div className="flex items-center gap-3">
            {bell(false)}
            <Link href="/account" className="flex items-center gap-2.5 rounded-xl py-1 ps-1 pe-3 text-sm ring-1 ring-gray-200 transition-colors hover:bg-accent-50 hover:ring-accent-500/40">
              <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-brand-700 to-brand-900 text-xs font-bold text-white">{actor.name.trim().charAt(0)}</span>
              <span className="font-medium text-gray-800">{actor.name}</span>
            </Link>
          </div>
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
