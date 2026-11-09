"use server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { clearSessionCookie, getActor, getRequestMeta } from "@/lib/auth/server";
import { logout } from "@/services/auth.service";

export async function logoutAction() {
  const actor = await getActor();
  await logout(prisma, actor, await getRequestMeta());
  await clearSessionCookie();
  redirect("/login");
}
