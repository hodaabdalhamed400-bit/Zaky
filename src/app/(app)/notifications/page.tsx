import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { formatDateTime } from "@/lib/dates";
import { NOTIFICATION_TYPE_LABELS, listNotifications } from "@/services/notifications.service";
import { Badge, Card, EmptyState, PageHeader, buttonClass, cx } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { markAllReadAction, openNotificationAction } from "./actions";

export const metadata: Metadata = { title: "الإشعارات" };

const COLOR = {
  CONTRACT_EXPIRING: "amber",
  PAYMENT_DUE: "blue",
  PAYMENT_OVERDUE: "red",
  CONTRACT_PENDING_APPROVAL: "amber",
  DOCUMENT_MISSING: "amber",
  PAYMENT_PENDING_REVIEW: "amber",
  SYSTEM: "gray",
} as const;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePageActor();
  const sp = await searchParams;
  const { items, unread, filter, page, pages } = await listNotifications(prisma, actor, sp);
  return (
    <>
      <PageHeader
        title="الإشعارات"
        description={unread ? `${unread} غير مقروء` : "لا توجد إشعارات غير مقروءة"}
        actions={unread > 0 ? <form action={markAllReadAction}><SubmitButton variant="secondary" pendingText="…">تعليم الكل كمقروء</SubmitButton></form> : undefined}
      />
      <div className="mb-4 flex gap-1 text-sm" role="tablist">
        {(["all", "unread"] as const).map((f) => (
          <Link key={f} href={`/notifications?filter=${f}`} role="tab" aria-selected={filter === f} className={cx("rounded-md px-3 py-1.5", filter === f ? "bg-brand-900 text-white" : "text-gray-600 hover:bg-gray-100")}>
            {f === "all" ? "الكل" : "غير المقروءة"}
          </Link>
        ))}
      </div>
      <Card>
        {items.length === 0 ? (
          <EmptyState icon="bell" title="لا توجد إشعارات" description="تصلك هنا تنبيهات العقود والدفعات والاعتمادات حسب صلاحياتك وفروعك." />
        ) : (
          <ul className="divide-y divide-gray-100">
            {items.map((n) => (
              <li key={n.id} className={cx("flex flex-wrap items-start justify-between gap-3 px-5 py-3.5", !n.readAt && "bg-accent-50/40")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {!n.readAt && <span className="size-2 rounded-full bg-accent-500" aria-label="غير مقروء" />}
                    <Badge color={COLOR[n.type]}>{NOTIFICATION_TYPE_LABELS[n.type]}</Badge>
                    <span className="text-xs text-gray-400">{formatDateTime(n.createdAt)}</span>
                  </div>
                  <p className={cx("mt-1 text-sm", n.readAt ? "text-gray-700" : "font-semibold text-gray-900")}>{n.title}</p>
                  {n.body && <p className="text-xs text-gray-500">{n.body}</p>}
                </div>
                <form action={openNotificationAction.bind(null, n.id)}>
                  <button type="submit" className={buttonClass("secondary", "text-xs")}>فتح</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {pages > 1 && (
        <nav className="mt-4 flex justify-center gap-2 text-sm">
          {page > 1 && <Link href={`/notifications?filter=${filter}&page=${page - 1}`} className={buttonClass("secondary")}>السابق</Link>}
          <span className="tabular px-2 py-2 text-gray-500">صفحة {page} من {pages}</span>
          {page < pages && <Link href={`/notifications?filter=${filter}&page=${page + 1}`} className={buttonClass("secondary")}>التالي</Link>}
        </nav>
      )}
    </>
  );
}
