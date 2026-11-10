"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireActionActor } from "@/lib/auth/server";
import { markAllRead, markRead } from "@/services/notifications.service";

export async function openNotificationAction(id: string) {
  const actor = await requireActionActor();
  let link = "/notifications";
  try {
    link = await markRead(prisma, actor, id);
  } catch {
    link = "/notifications";
  }
  revalidatePath("/", "layout");
  redirect(link);
}

export async function markAllReadAction() {
  const actor = await requireActionActor();
  await markAllRead(prisma, actor);
  revalidatePath("/", "layout");
}
