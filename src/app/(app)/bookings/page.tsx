import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { addDays, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { BOOKING_PAYMENT_COLOR, BOOKING_PAYMENT_LABELS, CLOSE_HOUR, OPEN_HOUR, bookingDay } from "@/services/bookings.service";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, buttonClass, cx, inputClass } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "حجوزات القاعات" };

const SLOT = { FREE: "bg-sky-100 border-sky-300 text-sky-900", UNPAID: "bg-amber-100 border-amber-300 text-amber-900", PAID: "bg-emerald-100 border-emerald-300 text-emerald-900" } as const;

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

  return (
    <>
      <PageHeader
        title="حجوزات القاعات"
        description="ساعتان مجانيتان يوميًا لكل مستأجر بعقد نشط (على كل الفروع)، والزائد بسعر ساعة القاعة."
        actions={canManage ? <LinkButton href={`/bookings/new?date=${d.date}`} icon="plus">حجز جديد</LinkButton> : undefined}
      />
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
            <Link href={link(addDays(d.date, -1))} className={buttonClass("ghost")}>→ اليوم السابق</Link>
            <Link href={link(today)} className={buttonClass("ghost")}>اليوم</Link>
            <Link href={link(addDays(d.date, 1))} className={buttonClass("ghost")}>اليوم التالي ←</Link>
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
          <CardHeader title={`جدول ${d.date}`} action={<span className="flex gap-2 text-xs">{(["FREE", "UNPAID", "PAID"] as const).map((k) => <span key={k} className={cx("rounded border px-2 py-0.5", SLOT[k])}>{BOOKING_PAYMENT_LABELS[k]}</span>)}</span>} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed border-collapse text-xs">
              <thead>
                <tr>
                  <th className="w-28 border-b border-gray-200 bg-gray-50 px-2 py-2 text-start">القاعة</th>
                  {hours.map((h) => <th key={h} className="border-b border-s border-gray-200 bg-gray-50 px-1 py-2 text-center font-medium text-gray-600 tabular">{h}:00</th>)}
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
                          <Link href={`/bookings/${b.id}`} className={cx("block truncate rounded border px-1.5 py-2 hover:opacity-80", SLOT[b.paymentStatus])} title={`${who(b)} — ${b.startHour}:00–${b.endHour}:00`}>
                            {who(b)}
                          </Link>
                        </td>,
                      );
                      h += b.hours;
                    } else {
                      const past = d.date < today;
                      cells.push(
                        <td key={h} className="border-s border-t border-gray-100 p-0.5">
                          {canManage && !past && r.status !== "MAINTENANCE" && r.status !== "INACTIVE" ? (
                            <Link href={`/bookings/new?unitId=${r.id}&date=${d.date}&startHour=${h}`} className="block rounded py-2 text-center text-gray-300 hover:bg-brand-50 hover:text-brand-700" aria-label={`حجز ${r.code} الساعة ${h}:00`}>+</Link>
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
