import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { DocumentCategory } from "@prisma/client";
import type { Db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import type { Actor, RequestMeta } from "@/lib/auth/actor";
import { assertBranchAccess, requirePermission } from "@/lib/rbac/guard";
import { getObject, newStorageKey, putObject } from "@/lib/storage";
import { assertTenantAccess } from "./access";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  CONTRACT_SIGNED: "عقد موقّع",
  CONTRACT_DRAFT: "مسودة عقد",
  ID_DOCUMENT: "هوية",
  COMMERCIAL_REGISTER: "سجل تجاري",
  VAT_CERTIFICATE: "شهادة ضريبية",
  PAYMENT_PROOF: "إثبات دفع",
  UNIT_PHOTO: "صورة وحدة",
  OTHER: "أخرى",
};
/** فئات حساسة دائمًا (لا تظهر إلا لمن يملك documents.view_sensitive) */
const ALWAYS_SENSITIVE: DocumentCategory[] = ["ID_DOCUMENT"];

/** التحقق من نوع الملف من محتواه الفعلي (التوقيع)، وليس من الامتداد أو نوع المتصفح. */
export function sniffMime(b: Uint8Array): string | null {
  const starts = (sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const EXT: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function safeFileName(name: string, mime: string) {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().slice(0, 80) || "مستند";
  return `${base}.${EXT[mime]}`;
}

const uploadSchema = z.object({
  category: z.enum(Object.keys(DOCUMENT_CATEGORY_LABELS) as [DocumentCategory, ...DocumentCategory[]], { message: "اختر نوع المستند" }),
  isSensitive: z.boolean().default(false),
  owner: z.union([
    z.object({ tenantId: z.string().uuid() }),
    z.object({ contractId: z.string().uuid() }),
    z.object({ unitId: z.string().uuid() }),
    z.object({ paymentId: z.string().uuid() }),
  ]),
});

async function assertOwnerAccess(db: Db, actor: Actor, owner: { tenantId?: string | null; contractId?: string | null; unitId?: string | null; paymentId?: string | null }) {
  if (owner.tenantId) return assertTenantAccess(db, actor, owner.tenantId);
  if (owner.contractId) {
    const c = await db.contract.findUnique({ where: { id: owner.contractId }, select: { branchId: true } });
    if (!c) throw new NotFoundError("العقد غير موجود");
    return assertBranchAccess(actor, c.branchId);
  }
  if (owner.unitId) {
    const u = await db.unit.findUnique({ where: { id: owner.unitId }, select: { branchId: true } });
    if (!u) throw new NotFoundError("الوحدة غير موجودة");
    return assertBranchAccess(actor, u.branchId);
  }
  if (owner.paymentId) {
    const p = await db.payment.findUnique({ where: { id: owner.paymentId }, select: { branchId: true } });
    if (!p) throw new NotFoundError("الدفعة غير موجودة");
    return assertBranchAccess(actor, p.branchId);
  }
  throw new AppError("VALIDATION", "المستند غير مرتبط بأي سجل");
}

export async function uploadDocument(
  db: Db,
  actor: Actor,
  raw: { file: { name: string; size: number; bytes: Uint8Array } | null; category: unknown; isSensitive?: unknown; owner: unknown },
  meta: RequestMeta = {},
) {
  requirePermission(actor, "documents.upload");
  const input = uploadSchema.parse({ category: raw.category, isSensitive: raw.isSensitive === true, owner: raw.owner });
  const file = raw.file;
  if (!file || file.size === 0) throw new AppError("VALIDATION", "اختر ملفًا");
  if (file.size > MAX_UPLOAD_BYTES || file.bytes.byteLength > MAX_UPLOAD_BYTES) throw new AppError("TOO_LARGE", "حجم الملف يتجاوز 10 ميجابايت");
  const mime = sniffMime(file.bytes);
  if (!mime) throw new AppError("BAD_TYPE", "نوع الملف غير مسموح. المسموح: PDF أو صور JPG/PNG/WEBP");
  await assertOwnerAccess(db, actor, input.owner);
  const isSensitive = input.isSensitive || ALWAYS_SENSITIVE.includes(input.category);
  if (isSensitive && !actor.permissions.has("documents.view_sensitive"))
    throw new ForbiddenError("لا تملك صلاحية رفع مستندات حساسة");

  const key = newStorageKey();
  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  await putObject(key, file.bytes);
  return db.$transaction(async (tx) => {
    const d = await tx.document.create({
      data: {
        category: input.category,
        fileName: safeFileName(file.name, mime),
        mimeType: mime,
        sizeBytes: file.bytes.byteLength,
        storageKey: key,
        sha256,
        isSensitive,
        uploadedById: actor.id,
        ...input.owner,
      },
    });
    await writeAudit(tx, {
      actorId: actor.id,
      action: "document.upload",
      entityType: "document",
      entityId: d.id,
      after: { category: d.category, fileName: d.fileName, isSensitive, owner: input.owner, sha256 },
      meta,
    });
    return d;
  });
}

/** قائمة مستندات كيان: الحساسة لا تُعرض لمن لا يملك صلاحيتها (يظهر عددها فقط). */
export async function listDocuments(db: Db, actor: Actor, owner: { tenantId?: string; contractId?: string; unitId?: string; paymentId?: string }) {
  if (!actor.permissions.has("documents.view")) return { documents: [], hiddenSensitive: 0, allowed: false };
  const all = await db.document.findMany({
    where: { ...owner, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, category: true, fileName: true, mimeType: true, sizeBytes: true, isSensitive: true, createdAt: true, uploadedById: true },
  });
  const canSensitive = actor.permissions.has("documents.view_sensitive");
  const documents = all.filter((d) => canSensitive || !d.isSensitive);
  return { documents, hiddenSensitive: all.length - documents.length, allowed: true };
}

export async function readDocument(db: Db, actor: Actor, id: string, meta: RequestMeta = {}) {
  requirePermission(actor, "documents.view");
  const d = await db.document.findUnique({ where: { id } });
  if (!d || d.deletedAt) throw new NotFoundError("المستند غير موجود");
  await assertOwnerAccess(db, actor, d);
  if (d.isSensitive && !actor.permissions.has("documents.view_sensitive")) throw new NotFoundError("المستند غير موجود");
  const data = await getObject(d.storageKey);
  if (createHash("sha256").update(data).digest("hex") !== d.sha256) throw new AppError("INTEGRITY", "فشل التحقق من سلامة الملف");
  if (d.isSensitive) await writeAudit(db, { actorId: actor.id, action: "document.view_sensitive", entityType: "document", entityId: d.id, meta });
  return { doc: d, data };
}

/** حذف منطقي فقط — الملف والسجل يبقيان للتدقيق. */
export async function deleteDocument(db: Db, actor: Actor, id: string, meta: RequestMeta = {}) {
  requirePermission(actor, "documents.upload");
  const d = await db.document.findUnique({ where: { id } });
  if (!d || d.deletedAt) throw new NotFoundError("المستند غير موجود");
  await assertOwnerAccess(db, actor, d);
  if (d.isSensitive && !actor.permissions.has("documents.view_sensitive")) throw new NotFoundError("المستند غير موجود");
  if (d.category === "CONTRACT_SIGNED" && d.contractId) {
    const c = await db.contract.findUnique({ where: { id: d.contractId }, select: { status: true } });
    if (c && c.status !== "DRAFT" && c.status !== "CANCELLED" && !actor.permissions.has("contracts.approve"))
      throw new ForbiddenError("حذف نسخة العقد الموقعة يتطلب صلاحية اعتماد العقود");
  }
  await db.$transaction(async (tx) => {
    await tx.document.update({ where: { id }, data: { deletedAt: new Date() } });
    await writeAudit(tx, { actorId: actor.id, action: "document.delete", entityType: "document", entityId: id, before: { fileName: d.fileName, category: d.category }, meta });
  });
}
