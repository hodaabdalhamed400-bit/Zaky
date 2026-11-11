import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { branchWhere } from "@/lib/rbac/guard";
import { todayInRiyadh } from "@/lib/dates";
import { listCategories } from "@/services/purchases.service";
import { Alert, Card, PageHeader } from "@/components/ui/primitives";
import { PurchaseForm } from "../purchase-form";
import { createPurchaseAction } from "../actions";

export const metadata: Metadata = { title: "إضافة فاتورة شراء" };

export default async function NewPurchasePage() {
  const actor = await requirePageActor("purchases.create");
  const [branches, categories] = await Promise.all([
    prisma.branch.findMany({ where: { ...branchWhere(actor, "id"), status: { not: "INACTIVE" } }, orderBy: { nameAr: "asc" }, select: { id: true, nameAr: true } }),
    listCategories(prisma),
  ]);
  return (
    <>
      <PageHeader title="إضافة فاتورة شراء" description="اكتب البيانات كما في فاتورة المورد وارفع صورتها. تُرسل للمحاسب للمراجعة والاعتماد." />
      {branches.length === 0 ? (
        <Alert kind="warning">لا يوجد فرع مخصص لحسابك.</Alert>
      ) : (
        <Card className="max-w-4xl">
          <div className="p-5 sm:p-6">
            <PurchaseForm action={createPurchaseAction} mode="create" branches={branches} categories={categories} today={todayInRiyadh()} />
          </div>
        </Card>
      )}
    </>
  );
}
