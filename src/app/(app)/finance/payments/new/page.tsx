import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { todayInRiyadh } from "@/lib/dates";
import { contractsWithBalance, openInstallments } from "@/services/payments.service";
import { Card, EmptyState, PageHeader, buttonClass, inputClass } from "@/components/ui/primitives";
import { PaymentForm } from "../../payment-form";
import { recordPaymentAction } from "../../actions";

export const metadata: Metadata = { title: "تسجيل دفعة" };

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<{ contractId?: string }> }) {
  const actor = await requirePageActor("payments.record");
  const { contractId } = await searchParams;

  if (!contractId || !/^[0-9a-f-]{36}$/i.test(contractId)) {
    const contracts = await contractsWithBalance(prisma, actor);
    return (
      <>
        <PageHeader title="تسجيل دفعة" description="اختر العقد أولًا." />
        <Card className="p-5">
          {contracts.length === 0 ? (
            <EmptyState icon="finance" title="لا توجد عقود عليها أقساط مفتوحة" />
          ) : (
            <form className="flex flex-wrap gap-2">
              <label htmlFor="contractId" className="sr-only">العقد</label>
              <select id="contractId" name="contractId" required className={inputClass + " max-w-xl"} defaultValue="">
                <option value="" disabled>اختر العقد…</option>
                {contracts.map((c) => <option key={c.id} value={c.id}>{c.tenant.name} — {c.contractNo} ({c.branch.nameAr})</option>)}
              </select>
              <button className={buttonClass("primary")}>متابعة</button>
            </form>
          )}
        </Card>
      </>
    );
  }

  const { contract, installments } = await openInstallments(prisma, actor, contractId).catch((e) => {
    if (e instanceof AppError && (e.status === 404 || e.status === 403)) notFound();
    throw e;
  });
  return (
    <>
      <PageHeader title="تسجيل دفعة" description={`${contract.tenant.name} · ${contract.contractNo} · ${contract.branch.nameAr}`} actions={<Link href="/finance/payments/new" className={buttonClass("ghost")}>تغيير العقد</Link>} />
      <Card className="p-5 sm:p-6">
        {installments.length === 0 ? (
          <EmptyState title="لا توجد أقساط مفتوحة على هذا العقد" />
        ) : (
          <PaymentForm action={recordPaymentAction} contractId={contract.id} installments={installments} idempotencyKey={randomUUID()} today={todayInRiyadh()} />
        )}
      </Card>
    </>
  );
}
