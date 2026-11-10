import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { todayInRiyadh } from "@/lib/dates";
import { tenantScope } from "@/services/access";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { BookingForm } from "../forms";
import { createBookingAction } from "../actions";

export const metadata: Metadata = { title: "حجز قاعة" };

export default async function NewBookingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor("bookings.manage");
  const sp = await searchParams;
  const today = todayInRiyadh();
  const [rooms, tenants] = await Promise.all([
    prisma.unit.findMany({
      where: { archivedAt: null, status: { notIn: ["INACTIVE", "MAINTENANCE"] }, unitType: { leaseMode: "BOOKING" }, branch: { status: { not: "INACTIVE" } }, ...branchWhere(actor, "branchId") },
      orderBy: [{ branch: { nameAr: "asc" } }, { code: "asc" }],
      select: { id: true, code: true, basePrice: true, pricingCycle: true, branch: { select: { nameAr: true } } },
    }),
    prisma.tenant.findMany({ where: { archivedAt: null, ...tenantScope(actor) }, orderBy: { name: "asc" }, take: 2000, select: { id: true, name: true, mobile: true } }),
  ]);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date >= today ? sp.date : today;
  const startHour = Math.min(21, Math.max(8, Number(sp.startHour) || 9));
  return (
    <>
      <PageHeader title="حجز قاعة" description="الحجز بالساعة الكاملة من 8 صباحًا إلى 10 مساءً." />
      <Card className="p-5 sm:p-6">
        {rooms.length === 0 ? (
          <EmptyState icon="units" title="لا توجد قاعات متاحة للحجز" description="أضف قاعة من «المكاتب والوحدات» بنوع «قاعة اجتماعات» وتسعير «بالساعة»." />
        ) : (
          <BookingForm
            action={createBookingAction}
            today={today}
            rooms={rooms.map((r) => ({ id: r.id, code: r.code, branchName: r.branch.nameAr, price: r.basePrice.toFixed(2), priced: r.pricingCycle === "HOUR" }))}
            tenants={tenants}
            initial={{ unitId: rooms.some((r) => r.id === sp.unitId) ? sp.unitId : undefined, date, startHour }}
          />
        )}
      </Card>
    </>
  );
}
