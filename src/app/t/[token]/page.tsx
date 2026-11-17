import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { dateOnly, formatDate, todayInRiyadh } from "@/lib/dates";
import { formatSAR } from "@/lib/money";
import { Badge } from "@/components/ui/primitives";
import { CONTRACT_STATUS_COLOR, CONTRACT_STATUS_LABELS } from "@/services/contracts.service";
import { PAYMENT_METHOD_LABELS } from "@/services/payments.service";
import { SHARE_SCHEDULE_LABELS, getSharedTenantView } from "@/services/tenant-share.service";
import { getRequestMeta } from "@/lib/auth/server";
import { rateLimit } from "@/lib/rate-limit";

export const metadata: Metadata = { title: "حسابي لدى ذكي", referrer: "no-referrer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SCHEDULE_COLOR = { PENDING: "amber", PARTIAL: "blue", PAID: "green", WAIVED: "gray", CANCELLED: "gray" } as const;

/** صفحة المستأجر العامة (برابط سري، عرض فقط). */
export default async function TenantSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // حد 60 فتحة بالدقيقة لكل IP (يمنع تخمين الروابط وإغراق قاعدة البيانات)
  const { ip } = await getRequestMeta();
  const v = rateLimit(`share:${ip ?? "unknown"}`, 60, 60_000) ? await getSharedTenantView(prisma, token) : null;
  const today = dateOnly(todayInRiyadh());

  return (
    <div className="min-h-dvh bg-[#f4f6f9]">
      <header className="bg-gradient-to-br from-brand-900 via-[#0f2a47] to-[#081828] text-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" className="h-10 w-auto rounded-lg bg-white p-1.5" />
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs ring-1 ring-white/15">عرض فقط</span>
        </div>
        {v && (
          <div className="mx-auto max-w-4xl px-4 pb-8 pt-2">
            <p className="text-sm text-accent-300">هلا والله 👋</p>
            <h1 className="mt-1 text-2xl font-bold">{v.tenant.name}</h1>
            <p className="mt-1 text-sm text-brand-100/80">ملخص عقودك ودفعاتك لدى ذكي لحاضنات ومسرعات الأعمال</p>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {!v ? (
          <div className="animate-scale-in mx-auto mt-10 max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-amber-50 text-2xl" aria-hidden="true">🔒</div>
            <h1 className="text-lg font-bold text-brand-900">الرابط غير صالح</h1>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">يمكن انتهت صلاحيته أو تم إلغاؤه. تواصل مع فرع ذكي ويرسلون لك رابط جديد.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Tile label="المستحق حتى اليوم" value={formatSAR(v.totals.due)} tone={v.totals.due.gt(0) ? "warn" : "good"} />
              <Tile label="منها متأخر" value={formatSAR(v.totals.overdue)} tone={v.totals.overdue.gt(0) ? "bad" : "good"} />
              <Tile label="القسط القادم" value={v.totals.nextDue ? formatSAR(v.totals.nextDue.amount) : "—"} hint={v.totals.nextDue ? `بتاريخ ${formatDate(v.totals.nextDue.date)}` : "ما فيه أقساط قادمة"} />
            </div>

            {v.contracts.length === 0 ? (
              <Section title="العقود"><p className="p-5 text-sm text-gray-500">ما فيه عقود لعرضها.</p></Section>
            ) : (
              v.contracts.map((c) => (
                <Section
                  key={c.id}
                  title={<span dir="ltr" className="font-mono">{c.contractNo}</span>}
                  aside={<Badge color={CONTRACT_STATUS_COLOR[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Badge>}
                >
                  <dl className="grid grid-cols-2 gap-4 border-b border-gray-100 p-5 text-sm sm:grid-cols-4">
                    <Item label="الفرع" value={c.branch.nameAr} />
                    <Item label="الوحدات" value={c.units.map((u) => u.unit.code).join("، ")} />
                    <Item label="المدة" value={`${formatDate(c.startDate)} — ${formatDate(c.endDate)}`} />
                    <Item label="قيمة العقد" value={formatSAR(c.totalAmount)} />
                  </dl>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr><th className="px-4 py-2.5 text-start font-medium">القسط</th><th className="px-4 py-2.5 text-start font-medium">الاستحقاق</th><th className="px-4 py-2.5 text-start font-medium">المبلغ</th><th className="px-4 py-2.5 text-start font-medium">المتبقي</th><th className="px-4 py-2.5 text-start font-medium">الحالة</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {c.schedules.map((s) => {
                          const left = s.amountDue.minus(s.amountPaid).minus(s.amountAdjusted);
                          const late = (s.status === "PENDING" || s.status === "PARTIAL") && s.dueDate < today && left.gt(0);
                          return (
                            <tr key={s.id} className={late ? "bg-red-50/50" : undefined}>
                              <td className="px-4 py-2.5 tabular">{s.seqNo}</td>
                              <td className="px-4 py-2.5 tabular">{formatDate(s.dueDate)}</td>
                              <td className="px-4 py-2.5 tabular">{formatSAR(s.amountDue)}</td>
                              <td className="px-4 py-2.5 tabular font-medium">{s.status === "PAID" || s.status === "WAIVED" ? "—" : formatSAR(left)}</td>
                              <td className="px-4 py-2.5">{late ? <Badge color="red">متأخر</Badge> : <Badge color={SCHEDULE_COLOR[s.status]}>{SHARE_SCHEDULE_LABELS[s.status]}</Badge>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Section>
              ))
            )}

            <Section title="الدفعات المستلمة">
              {v.payments.length === 0 ? (
                <p className="p-5 text-sm text-gray-500">ما فيه دفعات معتمدة بعد.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {v.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{formatSAR(p.amount)}</p>
                        <p className="text-xs text-gray-500">{formatDate(p.paidOn)} · {PAYMENT_METHOD_LABELS[p.method]}{p.contract ? ` · العقد ${p.contract.contractNo}` : ""}</p>
                      </div>
                      <span dir="ltr" className="rounded-md bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">{p.receiptNo}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <p className="pb-6 text-center text-xs leading-relaxed text-gray-400">
              هذه الصفحة للاطلاع فقط وتنتهي صلاحية رابطها في {formatDate(v.expiresAt)}. لأي استفسار أو لطلب إيصال، تواصل مع فرعك.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "warn" | "bad" }) {
  const bar = tone === "bad" ? "bg-red-500" : tone === "warn" ? "bg-amber-500" : tone === "good" ? "bg-emerald-500" : "bg-accent-500";
  return (
    <div className="relative overflow-hidden rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <span className={`absolute inset-y-0 start-0 w-1 ${bar}`} aria-hidden="true" />
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular text-brand-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function Section({ title, aside, children }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="animate-fade-up overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-brand-900">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-gray-900">{value}</dd>
    </div>
  );
}
