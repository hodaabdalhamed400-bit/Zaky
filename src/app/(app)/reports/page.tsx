import type { Metadata } from "next";
import Link from "next/link";
import { requirePageActor } from "@/lib/auth/server";
import { REPORTS, canViewReport } from "@/services/reports.service";
import { Card, PageHeader } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "التقارير" };

export default async function ReportsPage() {
  const actor = await requirePageActor("reports.view");
  const list = Object.entries(REPORTS).filter(([k]) => canViewReport(actor, k));
  return (
    <>
      <PageHeader title="التقارير" description={actor.permissions.has("reports.export") ? "اعرض أي تقرير وصدّره إلى Excel أو PDF بالعربية." : "اعرض التقارير المتاحة لصلاحياتك (التصدير غير متاح لدورك)."} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map(([key, d]) => (
          <Link key={key} href={`/reports/${key}`} className="group">
            <Card className="h-full p-5 transition group-hover:border-accent-300 group-hover:shadow">
              <div className="flex items-start gap-3">
                <span className="rounded-lg bg-accent-50 p-2 text-accent-700"><Icon name="reports" className="size-5" /></span>
                <div>
                  <p className="font-semibold text-gray-900">{d.title}</p>
                  <p className="mt-1 text-sm text-gray-500">{d.description}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
