"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getRequestMeta, requireActionActor } from "@/lib/auth/server";
import { toSafeMessage } from "@/lib/errors";
import { commitBranchImport, MAX_IMPORT_BYTES, previewBranchImport, type ImportPreview, type ImportResult } from "@/services/branch-import.service";

export type ImportState = { error?: string; preview?: ImportPreview; result?: ImportResult; fileName?: string };

export async function importAction(branchId: string, _p: ImportState, fd: FormData): Promise<ImportState> {
  const actor = await requireActionActor();
  const f = fd.get("file");
  if (!(f instanceof File) || f.size === 0) return { error: "اختر ملف Excel أولًا" };
  if (f.size > MAX_IMPORT_BYTES) return { error: "حجم الملف أكبر من 5 ميجابايت" };
  if (!/\.xlsx$/i.test(f.name)) return { error: "الملف يجب أن يكون Excel بصيغة ‎.xlsx‎" };
  const bytes = new Uint8Array(await f.arrayBuffer());
  try {
    const intent = fd.get("intent");
    if (intent === "commit" || intent === "partial") {
      const result = await commitBranchImport(prisma, actor, branchId, bytes, await getRequestMeta(), { partial: intent === "partial" });
      for (const p of [`/branches/${branchId}`, "/units", "/tenants", "/contracts", "/finance", "/"]) revalidatePath(p);
      return { result, fileName: f.name };
    }
    return { preview: await previewBranchImport(prisma, actor, branchId, bytes), fileName: f.name };
  } catch (e) {
    return { error: toSafeMessage(e) };
  }
}
