import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { getDashboardStats } from "@/services/dashboard.service";
import { formatSAR } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { AUDIT_ACTION_LABELS } from "@/lib/audit";
import { hasBranchAccess } from "@/lib/rbac/guard";
import { Alert, Card, CardHeader, EmptyState, PageHeader, inputClass, buttonClass } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/stat-card";

export const metadata: Metadata = { title: "لوحة التحكم" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const actor = await requirePageActor("dashboard.view");
  const { branch } = await searchParams;

  const branches = await prisma.branch.findMany({
    where: { status: { not: "INACTIVE" }, ...(actor.allBranches ? {} : { id: { in: [...actor.branchIds] } }) },
    orderBy: { code: "asc" },
    select: { id: true, nameAr: true },
  });
  const branchId = branch && branches.some((b) => b.id === branch) && hasBranchAccess(actor, branch) ? branch : undefined;
  const s = await getDashboardStats(prisma, actor, { branchId });

  const recent = actor.permissions.has("audit.view")
    ? await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { user: { select: { name: true } } },
      })
    : [];

  const noBranches = !actor.allBranches && actor.branchIds.length === 0;

  return (
    <>
      <PageHeader
        title={`مرحبًا، ${actor.name}`}
        description="ملخص الفروع والإشغال والعقود والتحصيل — الأرقام محسوبة مباشرة من قاعدة البيانات."
        actions={
          branches.length > 1 ? (
            <form className="flex gap-2" role="search" aria-label="تصفية حسب الفرع">
              <label htmlFor="branch" className="sr-only">الفرع</label>
              <select id="branch" name="branch" defaultValue={branchId ?? ""} className={inputClass + " w-48"}>
                <option value="">كل الفروع المتاحة لي</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.nameAr}</option>
                ))}
              </select>
              <button type="submit" className={buttonClass("secondary")}>عرض</button>
            </form>
          ) : undefined
        }
      />

      {noBranches && (
        <div className="mb-6">
          <Alert kind="warning">لم يُخصَّص لحسابك أي فرع بعد. تواصل مع مسؤول النظام لمنحك صلاحية على الفروع.</Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="الفروع العاملة" value={String(s.branches)} hint={s.preparingBranches ? `+ ${s.preparingBranches} قيد التجهيز` : undefined} icon="branches" />
        <StatCard label="إجمالي الوحدات" value={String(s.units)} icon="units" />
        <StatCard label="الوحدات المؤجرة" value={String(s.rentedUnits)} icon="units" tone="good" />
        <StatCard label="الوحدات المتاحة" value={String(s.availableUnits)} icon="units" />
        <StatCard
          label="نسبة الإشغال"
          value={s.occupancyPct === null ? "—" : `${s.occupancyPct}%`}
          hint={`حسب الوحدات${s.seatsOccupancyPct !== null ? ` · المقاعد ${s.seatsOccupancyPct}%` : ""}`}
          icon="reports"
        />
        <StatCard label="العقود النشطة" value={String(s.activeContracts)} icon="contracts" />
        <StatCard label="عقود تنتهي قريبًا" value={String(s.expiringContracts)} hint={`خلال ${s.expiringWithinDays} يومًا`} icon="contracts" tone="warn" />
        <StatCard label="المستحق حتى اليوم" value={formatSAR(s.dueAmount)} hint="غير مسدد" icon="finance" />
        <StatCard label="المحصّل هذا الشهر" value={formatSAR(s.collectedThisMonth)} hint="دفعات معتمدة فقط" icon="finance" tone="good" />
        <StatCard label="المبالغ المتأخرة" value={formatSAR(s.overdueAmount)} hint="تجاوزت تاريخ الاستحقاق" icon="alert" tone="bad" />
      </div>

      {s.units === 0 && (
        <Card className="mt-6">
          <EmptyState
            icon="units"
            title="لا توجد وحدات مسجلة بعد"
            description="ستظهر مؤشرات الإشغال بعد إضافة المكاتب والوحدات، ثم العقود والتحصيل بعد تفعيلها. لا يعرض النظام أي أرقام تجريبية."
            action={actor.permissions.has("units.manage") ? <Link href="/units/new" className={buttonClass("primary")}>إضافة وحدة</Link> : undefined}
          />
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="العقود التي ستنتهي قريبًا" />
          <EmptyState title="لا توجد بيانات" description="يُفعَّل هذا الجدول مع وحدة العقود (المرحلة الثالثة)." />
        </Card>
        <Card>
          <CardHeader title="آخر عمليات التحصيل" />
          <EmptyState title="لا توجد بيانات" description="يُفعَّل هذا الجدول مع وحدة التحصيل (المرحلة الرابعة)." />
        </Card>
        {actor.permissions.has("audit.view") && (
          <Card className="lg:col-span-2">
            <CardHeader title="آخر الأنشطة" action={<Link href="/audit" className="text-sm text-brand-700 hover:underline">عرض السجل</Link>} />
            {recent.length === 0 ? (
              <EmptyState title="لا توجد أنشطة" />
            ) : (
              <ul className="divide-y divide-gray-100">
                {recent.map((r) => (
                  <li key={r.id.toString()} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium text-gray-900">{r.user?.name ?? "النظام"}</span>
                      <span className="text-gray-500"> — {AUDIT_ACTION_LABELS[r.action] ?? r.action}</span>
                    </span>
                    <span className="tabular text-xs text-gray-400">{formatDateTime(r.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
