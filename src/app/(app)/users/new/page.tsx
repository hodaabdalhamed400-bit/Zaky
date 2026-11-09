import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requirePageActor } from "@/lib/auth/server";
import { listAssignableOptions } from "@/services/users.service";
import { Card, PageHeader } from "@/components/ui/primitives";
import { UserForm } from "../user-form";
import { createUserAction } from "../actions";

export const metadata: Metadata = { title: "مستخدم جديد" };

export default async function NewUserPage() {
  const actor = await requirePageActor("users.manage");
  const { roles, branches } = await listAssignableOptions(prisma, actor);
  return (
    <>
      <PageHeader title="مستخدم جديد" description="لا يمكنك منح دور أو فرع يتجاوز صلاحياتك." />
      <Card className="p-5 sm:p-6">
        <UserForm mode="create" action={createUserAction} roles={roles} branches={branches} />
      </Card>
    </>
  );
}
