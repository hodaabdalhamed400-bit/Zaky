import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageActor } from "@/lib/auth/server";
import { Card, PageHeader } from "@/components/ui/primitives";
import { BranchForm } from "../branch-form";
import { createBranchAction } from "../actions";

export const metadata: Metadata = { title: "فرع جديد" };

export default async function NewBranchPage() {
  const actor = await requirePageActor("branches.manage");
  if (!actor.allBranches) redirect("/forbidden");
  return (
    <>
      <PageHeader title="فرع جديد" description="يمكن إنشاء الفرع بحالة «قيد التجهيز» وإضافة وحداته قبل الافتتاح." />
      <Card className="p-5 sm:p-6">
        <BranchForm action={createBranchAction} />
      </Card>
    </>
  );
}
