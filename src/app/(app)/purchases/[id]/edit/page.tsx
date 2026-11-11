import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { todayInRiyadh } from "@/lib/dates";
import { getPurchase, listCategories } from "@/services/purchases.service";
import { Alert, Card, PageHeader } from "@/components/ui/primitives";
import { PurchaseForm } from "../../purchase-form";
import { updatePurchaseAction } from "../../actions";

export const metadata: Metadata = { title: "تعديل فاتورة شراء" };

export default async function EditPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("purchases.create");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { invoice: p } = await getPurchase(prisma, actor, id).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  if (p.status === "APPROVED") redirect(`/purchases/${id}`);
  const categories = await listCategories(prisma);
  if (!categories.some((c) => c.id === p.categoryId)) categories.push({ id: p.categoryId, nameAr: p.category.nameAr, isActive: false, sortOrder: 0, createdAt: new Date(), _count: { invoices: 0 } });
  return (
    <>
      <PageHeader title={`تعديل ${p.refNo}`} description={`${p.branch.nameAr} — بعد الحفظ تعود الفاتورة للمراجعة.`} />
      {p.status === "REJECTED" && <div className="mb-4"><Alert>سبب الإرجاع: {p.rejectionReason}</Alert></div>}
      <Card className="max-w-4xl">
        <div className="p-5 sm:p-6">
          <PurchaseForm
            action={updatePurchaseAction.bind(null, id)}
            mode="edit"
            branches={[]}
            categories={categories}
            today={todayInRiyadh()}
            defaults={{
              categoryId: p.categoryId,
              supplierName: p.supplierName,
              supplierVatNo: p.supplierVatNo ?? "",
              invoiceNo: p.invoiceNo,
              invoiceDate: p.invoiceDate.toISOString().slice(0, 10),
              totalAmount: p.totalAmount.toFixed(2),
              vatAmount: p.vatAmount.toFixed(2),
              description: p.description ?? "",
            }}
          />
        </div>
      </Card>
    </>
  );
}
