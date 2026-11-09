import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { formatSAR } from "@/lib/money";
import { PRICING_CYCLE_LABELS, effectiveUnitStatus, listUnits, unitFormOptions } from "@/services/units.service";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Th, buttonClass, cx, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "المكاتب والوحدات" };

type SP = Record<string, string | undefined>;

function qs(sp: SP, patch: SP) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/units?${s}` : "/units";
}

export default async function UnitsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const actor = await requirePageActor("units.view");
  const sp = await searchParams;
  const view = sp.view === "cards" ? "cards" : "table";
  const [res, opts] = await Promise.all([listUnits(prisma, actor, sp), unitFormOptions(prisma, actor)]);
  const { units, total, page, pages, filters } = res;
  const canManage = actor.permissions.has("units.manage");
  const hasFilters = Object.entries(filters).some(([k, v]) => v && k !== "page");

  return (
    <>
      <PageHeader
        title="المكاتب والوحدات"
        description={`${total} وحدة${filters.archived ? " مؤرشفة" : ""} مطابقة`}
        actions={canManage ? <LinkButton href={filters.branchId ? `/units/new?branchId=${filters.branchId}` : "/units/new"} icon="plus">وحدة جديدة</LinkButton> : undefined}
      />

      <Card className="mb-4">
        <form className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="تصفية الوحدات">
          <input type="hidden" name="view" value={view} />
          <div className="lg:col-span-2">
            <label htmlFor="q" className="sr-only">بحث</label>
            <input id="q" name="q" defaultValue={filters.q} placeholder="بحث برقم الوحدة أو الوصف…" className={inputClass} />
          </div>
          <div>
            <label htmlFor="f-branch" className="sr-only">الفرع</label>
            <select id="f-branch" name="branchId" defaultValue={filters.branchId ?? ""} className={inputClass}>
              <option value="">كل الفروع</option>
              {opts.branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="f-status" className="sr-only">الحالة</label>
            <select id="f-status" name="status" defaultValue={filters.status ?? ""} className={inputClass}>
              <option value="">كل الحالات</option>
              <option value="FREE">متاحة فعليًا (بلا عقد)</option>
              <option value="OCCUPIED">مؤجرة (عقد نشط)</option>
              <option value="RESERVED">محجوزة</option>
              <option value="MAINTENANCE">صيانة</option>
              <option value="INACTIVE">غير نشطة</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-type" className="sr-only">النوع</label>
            <select id="f-type" name="unitTypeId" defaultValue={filters.unitTypeId ?? ""} className={inputClass}>
              <option value="">كل الأنواع</option>
              {opts.types.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" name="archived" value="1" defaultChecked={!!filters.archived} className="size-4 accent-brand-700" />
            المؤرشفة
          </label>
          <div className="flex gap-2 lg:col-span-2">
            <input name="minArea" defaultValue={filters.minArea} inputMode="decimal" placeholder="مساحة من" aria-label="المساحة من" className={inputClass} />
            <input name="maxArea" defaultValue={filters.maxArea} inputMode="decimal" placeholder="إلى (م²)" aria-label="المساحة إلى" className={inputClass} />
          </div>
          <div className="flex gap-2 lg:col-span-2">
            <input name="minPrice" defaultValue={filters.minPrice} inputMode="decimal" placeholder="سعر من" aria-label="السعر من" className={inputClass} />
            <input name="maxPrice" defaultValue={filters.maxPrice} inputMode="decimal" placeholder="إلى (ر.س)" aria-label="السعر إلى" className={inputClass} />
          </div>
          <div className="flex gap-2 lg:col-span-2">
            <button className={buttonClass("primary", "flex-1")}>تطبيق</button>
            {hasFilters && <Link href={`/units?view=${view}`} className={buttonClass("ghost")}>مسح</Link>}
          </div>
        </form>
        <div className="flex items-center justify-end gap-1 border-t border-gray-100 px-4 py-2 text-sm" aria-label="طريقة العرض">
          <Link href={qs(sp, { view: "table" })} aria-current={view === "table" ? "true" : undefined} className={cx("rounded-md px-3 py-1", view === "table" ? "bg-brand-900 text-white" : "text-gray-600 hover:bg-gray-100")}>جدول</Link>
          <Link href={qs(sp, { view: "cards" })} aria-current={view === "cards" ? "true" : undefined} className={cx("rounded-md px-3 py-1", view === "cards" ? "bg-brand-900 text-white" : "text-gray-600 hover:bg-gray-100")}>بطاقات</Link>
        </div>
      </Card>

      {units.length === 0 ? (
        <Card>
          <EmptyState
            icon="units"
            title={hasFilters ? "لا توجد وحدات مطابقة" : "لا توجد وحدات بعد"}
            description={hasFilters ? "جرّب تعديل معايير البحث." : "أضف مكاتب ووحدات كل فرع لتبدأ متابعة الإشغال."}
            action={canManage && !hasFilters ? <LinkButton href="/units/new" icon="plus">إضافة أول وحدة</LinkButton> : undefined}
          />
        </Card>
      ) : view === "table" ? (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>الوحدة</Th>
                <Th>الفرع</Th>
                <Th>النوع</Th>
                <Th>المساحة</Th>
                <Th>السعة</Th>
                <Th>السعر</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const st = effectiveUnitStatus(u, u.occupiedSeats);
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <Td>
                      <Link href={`/units/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.code}</Link>
                      {u.floor && <span className="block text-xs text-gray-400">{u.floor.name}</span>}
                    </Td>
                    <Td>{u.branch.nameAr}</Td>
                    <Td>{u.unitType.nameAr}</Td>
                    <Td className="tabular">{u.areaSqm ? `${u.areaSqm.toFixed(2)} م²` : <span className="text-gray-400">—</span>}</Td>
                    <Td className="tabular">{u.capacity}</Td>
                    <Td className="tabular whitespace-nowrap">{formatSAR(u.basePrice)}<span className="text-xs text-gray-400"> / {PRICING_CYCLE_LABELS[u.pricingCycle]}</span></Td>
                    <Td><Badge color={st.color}>{st.label}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {units.map((u) => {
            const st = effectiveUnitStatus(u, u.occupiedSeats);
            return (
              <li key={u.id}>
                <Link href={`/units/${u.id}`} className="block rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-accent-300 hover:shadow">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-lg font-bold text-gray-900">{u.code}</p>
                      <p className="text-xs text-gray-500">{u.branch.nameAr}{u.floor ? ` · ${u.floor.name}` : ""}</p>
                    </div>
                    <Badge color={st.color}>{st.label}</Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-gray-50 p-2"><dt className="text-gray-500">النوع</dt><dd className="mt-0.5 font-medium text-gray-800">{u.unitType.nameAr}</dd></div>
                    <div className="rounded-lg bg-gray-50 p-2"><dt className="text-gray-500">المساحة</dt><dd className="tabular mt-0.5 font-medium text-gray-800">{u.areaSqm ? `${u.areaSqm.toFixed(0)} م²` : "—"}</dd></div>
                    <div className="rounded-lg bg-gray-50 p-2"><dt className="text-gray-500">السعة</dt><dd className="tabular mt-0.5 font-medium text-gray-800">{u.capacity}</dd></div>
                  </dl>
                  <p className="tabular mt-3 text-sm font-semibold text-brand-900">{formatSAR(u.basePrice)} <span className="text-xs font-normal text-gray-400">/ {PRICING_CYCLE_LABELS[u.pricingCycle]}</span></p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm" aria-label="الصفحات">
          {page > 1 && <Link href={qs(sp, { page: String(page - 1) })} className={buttonClass("secondary")}>السابق</Link>}
          <span className="tabular px-2 text-gray-500">صفحة {page} من {pages}</span>
          {page < pages && <Link href={qs(sp, { page: String(page + 1) })} className={buttonClass("secondary")}>التالي</Link>}
        </nav>
      )}
    </>
  );
}
