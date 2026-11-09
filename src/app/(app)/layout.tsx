import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/server";
import { NAV } from "@/components/layout/nav";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Icon } from "@/components/ui/icons";
import { logoutAction } from "../actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  // القائمة تعرض فقط ما يملك المستخدم صلاحيته (والتحقق الحقيقي يتم في كل صفحة/إجراء)
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => actor.permissions.has(i.perm)) })).filter(
    (s) => s.items.length > 0,
  );

  const footer = (
    <div className="space-y-1">
      <Link href="/account" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-50/85 hover:bg-white/10 hover:text-white">
        <span className="grid size-8 place-items-center rounded-full bg-white/15 text-xs font-bold text-white">
          {actor.name.trim().charAt(0)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-white">{actor.name}</span>
          <span className="block truncate text-xs text-brand-100/70">{actor.roleNameAr}</span>
        </span>
      </Link>
      <form action={logoutAction}>
        <button type="submit" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-50/85 hover:bg-white/10 hover:text-white">
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
      <SidebarNav sections={sections} footer={footer} />
      <main id="main" className="lg:ps-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
