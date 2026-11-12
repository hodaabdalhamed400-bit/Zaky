import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { addDays, todayInRiyadh } from "@/lib/dates";
import { formatSAR, sum } from "@/lib/money";
import { BOOKING_PAYMENT_COLOR, BOOKING_PAYMENT_LABELS, CLOSE_HOUR, OPEN_HOUR, bookingDay } from "@/services/bookings.service";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, buttonClass, cx, inputClass } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import { StatCard } from "@/components/ui/stat-card";
import { OccupancyRing } from "@/components/ui/occupancy-ring";

export const metadata: Metadata = { title: "حجوزات القاعات" };

const SLOT = { FREE: "bg-sky-100 border-sky-300 text-sky-900", UNPAID: "bg-amber-100 border-amber-300 text-amber-900", PAID: "bg-emerald-100 border-emerald-300 text-emerald-900" } as const;
const SLOT_EDGE = { FREE: "border-s-sky-500", UNPAID: "border-s-amber-500", PAID: "border-s-emerald-500" } as const;
const WEEKDAY = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/** الساعة الحالية بتوقيت الرياض */
const nowHourRiyadh = () => Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Riyadh" }).format(new Date()));

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor("bookings.view");
  const sp = await searchParams;
  const d = await bookingDay(prisma, actor, sp);
  const canManage = actor.permissions.has("bookings.manage");
  const today = todayInRiyadh();
  const hours = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);
  const confirmed = d.bookings.filter((b) => b.status === "CONFIRMED");
  const link = (date: string) => `/bookings?branchId=${d.branchId ?? ""}&date=${date}`;
  const who = (b: (typeof d.bookings)[number]) => b.tenant?.name ?? `${b.visitorName} (زائر)`;
  const isToday = d.date === today;
  const nowH = isToday ? nowHourRiyadh() : -1;
  const bookedHours = confirmed.reduce((a, b) => a + b.hours, 0);
  const capacityHours = d.rooms.length * (CLOSE_HOUR - OPEN_HOUR);
  const util = capacityHours ? Math.round((bookedHours / capacityHours) * 1000) / 10 : null;
  const due = sum(confirmed.filter((b) => b.paymentStatus === "UNPAID").map((b) => b.chargeAmount));
  const freeHours = confirmed.reduce((a, b) => a + b.freeHours, 0);
  const roomHours = (id: string) => confirmed.filter((b) => b.unitId === id).reduce((a, b) => a + b.hours, 0);

  return (
    <>
      <PageHeader
        title="حجوزات القاعات"
        description="ساعتان مجانيتان يوميًا لكل مستأجر بعقد نشط (على كل الفروع)، والزائد بسعر ساعة القاعة."
        actions={canManage ? <LinkButton href={`/bookings/new?date=${d.date}`} icon="plus">حجز جديد</LinkButton> : undefined}
      />
      {d.rooms.length > 0 && (
        <div className="stagger mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={isToday ? "حجوزات اليوم" : "حجوزات هذا اليوم"} value={String(confirmed.length)} hint={`${d.rooms.length} قاعة في الفرع`} icon="calendar" />
          <StatCard label="الساعات المحجوزة" value={String(bookedHours)} hint={`من ${capacityHours} ساعة متاحة`} icon="reports" tone="good" />
          <StatCard label="ساعات مجانية مستخدمة" value={String(freeHours)} hint="للمستأجرين بعقود نشطة" icon="check" />
          <StatCard label="مبالغ لم تُسدد" value={formatSAR(due)} hint="حجوزات غير مدفوعة في هذا اليوم" icon="finance" tone={due.gt(0) ? "warn" : "default"} />
        </div>
      )}
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="branchId" className="mb-1 block text-xs text-gray-500">الفرع</label>
            <select id="branchId" name="branchId" defaultValue={d.branchId ?? ""} className={inputClass.replace("w-full", "w-48")}>
              {d.branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="date" className="mb-1 block text-xs text-gray-500">التاريخ</label>
            <input id="date" name="date" type="date" defaultValue={d.date} className={inputClass.replace("w-full", "w-44")} />
          </div>
          <button className={buttonClass("secondary")}>عرض</button>
          <div className="ms-auto flex gap-1 text-sm">
            <Link href={link(addDays(d.date, -1))} className={buttonClass("secondary")}>→ اليوم السابق</Link>
            <Link href={link(today)} className={buttonClass(isToday ? "primary" : "secondary")}>اليوم</Link>
            <Link href={link(addDays(d.date, 1))} className={buttonClass("secondary")}>اليوم التالي ←</Link>
          </div>
        </form>
      </Card>

      {d.rooms.length === 0 ? (
        <Card>
          <EmptyState
            icon="units"
            title="لا توجد قاعات في هذا الفرع"
            description="أضف القاعات من «المكاتب والوحدات» بنوع «قاعة اجتماعات» ودورة تسعير «بالساعة»."
            action={actor.permissions.has("units.manage") ? <LinkButton href="/units/new" variant="secondary">إضافة قاعة</LinkButton> : undefined}
          />
        </Card>
      ) : (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 px-5 py-4">
            <div className="flex items-center gap-4">
              <OccupancyRing pct={util} size={64} stroke={6} label="إشغال" />
              <div>
                <h2 className="text-lg font-bold text-brand-900">{WEEKDAY.format(new Date(`${d.date}T00:00:00Z`))}</h2>
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  {isToday && <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping-soft rounded-full bg-accent-500" /><span className="relative inline-flex size-2 rounded-full bg-accent-500" /></span>}
                  {isToday ? "اليوم" : `جدول ${d.date}`} · {bookedHours} ساعة محجوزة
                </p>
              </div>
            </div>
            <span className="flex flex-wrap gap-2 text-xs">{(["FREE", "UNPAID", "PAID"] as const).map((k) => <span key={k} className={cx("rounded-md border border-s-4 px-2 py-0.5", SLOT[k], SLOT_EDGE[k])}>{BOOKING_PAYMENT_LABELS[k]}</span>)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  <th className="w-28 border-b border-gray-200 bg-gray-50 px-2 py-2 text-start">القاعة</th>
                  {hours.map((h) => (
                    <th key={h} className={cx("border-b border-s border-gray-200 px-1 py-2 text-center font-medium tabular", h === nowH ? "bg-accent-500 text-white" : "bg-gray-50 text-gray-600")} aria-current={h === nowH ? "time" : undefined}>
                      {h}:00
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rooms.map((r) => {
                  const cells: React.ReactNode[] = [];
                  for (let h = OPEN_HOUR; h < CLOSE_HOUR; ) {
                    const b = confirmed.find((x) => x.unitId === r.id && x.startHour === h);
                    if (b) {
                      cells.push(
                        <td key={h} colSpan={b.hours} className="border-s border-t border-gray-100 p-0.5">
                          <Link href={`/bookings/${b.id}`} className={cx("block animate-scale-in truncate rounded-md border border-s-4 px-1.5 py-2 font-medium shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md", SLOT[b.paymentStatus], SLOT_EDGE[b.paymentStatus])} title={`${who(b)} — ${b.startHour}:00–${b.endHour}:00`}>
                            {who(b)}
                          </Link>
                        </td>,
                      );
                      h += b.hours;
                    } else {
                      const past = d.date < today;
                      cells.push(
                        <td key={h} className={cx("border-s border-t border-gray-100 p-0.5", h === nowH && "bg-accent-50/60")}>
                          {canManage && !past && r.status !== "MAINTENANCE" && r.status !== "INACTIVE" ? (
                            <Link href={`/bookings/new?unitId=${r.id}&date=${d.date}&startHour=${h}`} className="block rounded-md py-2 text-center text-gray-300 transition-all duration-200 hover:scale-105 hover:bg-accent-50 hover:font-bold hover:text-accent-700" aria-label={`حجز ${r.code} الساعة ${h}:00`}>+</Link>
                          ) : <span className="block py-2" />}
                        </td>,
                      );
                      h += 1;
                    }
                  }
                  return (
                    <tr key={r.id}>
                      <th scope="row" className="border-t border-gray-100 px-2 py-1 text-start font-medium">
                        {r.code}
                        <span className="block font-normal text-gray-400">{r.pricingCycle === "HOUR" ? `${formatSAR(r.basePrice)}/ساعة` : "السعر ليس بالساعة"}</span>
                        <span className="mt-1 block h-1 overflow-hidden rounded-full bg-gray-100" aria-label={`محجوز ${roomHours(r.id)} من ${CLOSE_HOUR - OPEN_HOUR} ساعة`}>
                          <span className="block h-full origin-right animate-grow-x rounded-full bg-gradient-to-l from-accent-500 to-brand-700" style={{ width: `${(roomHours(r.id) / (CLOSE_HOUR - OPEN_HOUR)) * 100}%` }} />
                        </span>
                      </th>
                      {cells}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {d.bookings.length > 0 && (
        <Card className="mt-6">
          <CardHeader title={`حجوزات اليوم (${confirmed.length})`} />
          <ul className="divide-y divide-gray-100 text-sm">
            {d.bookings.map((b) => (
              <li key={b.id} className={cx("flex flex-wrap items-center justify-between gap-2 px-5 py-3", b.status === "CANCELLED" && "opacity-50")}>
                <span>
                  <Link href={`/bookings/${b.id}`} className="font-medium text-brand-700 hover:underline">{who(b)}</Link>
                  <span className="ms-2 text-xs text-gray-500">{b.unit.code} · {b.startHour}:00–{b.endHour}:00 · <span dir="ltr">{b.bookingNo}</span></span>
                </span>
                <span className="flex items-center gap-2">
                  {b.status === "CANCELLED" ? <Badge>ملغى</Badge> : <Badge color={BOOKING_PAYMENT_COLOR[b.paymentStatus]}>{BOOKING_PAYMENT_LABELS[b.paymentStatus]}</Badge>}
                  {b.chargeAmount.gt(0) && <span className="tabular text-xs">{formatSAR(b.chargeAmount)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
