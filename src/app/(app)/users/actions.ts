"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor, type FormState } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { createUser, resetUserPassword, updateUser } from "@/services/users.service";
import { resetUserMfa } from "@/services/mfa.service";

export type { FormState };

function readCommon(fd: FormData) {
  return {
    name: String(fd.get("name") ?? ""),
    phone: String(fd.get("phone") ?? ""),
    roleId: String(fd.get("roleId") ?? ""),
    branchIds: fd.getAll("branchIds").map(String),
  };
}

export async function createUserAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  let id: string;
  try {
    const user = await createUser(
      prisma,
      actor,
      { ...readCommon(fd), email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? "") },
      await getRequestMeta(),
    );
    id = user.id;
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/users");
  redirect(`/users/${id}?created=1`);
}

export async function updateUserAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await updateUser(prisma, actor, id, { ...readCommon(fd), isActive: fd.get("isActive") === "on" }, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath("/users");
  revalidatePath(`/users/${id}`);
  return { success: "تم حفظ التعديلات" };
}

export async function resetPasswordAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await resetUserPassword(prisma, actor, id, String(fd.get("password") ?? ""), await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  return { success: "تم تعيين كلمة مرور مؤقتة وإنهاء جلسات المستخدم. سيُطلب منه تغييرها عند الدخول." };
}

export async function resetMfaAction(id: string, _prev: FormState, _fd: FormData): Promise<FormState> {
  const actor = await requireActionActor();
  try {
    await resetUserMfa(prisma, actor, id, await getRequestMeta());
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
  revalidatePath(`/users/${id}`);
  return { success: "تمت إعادة تعيين التحقق الثنائي وإنهاء جلسات المستخدم. سيُطلب منه التفعيل من جديد." };
}
