import type { DocumentCategory } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/actor";
import { formatDateTime } from "@/lib/dates";
import { DOCUMENT_CATEGORY_LABELS, listDocuments } from "@/services/documents.service";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import { DeleteDocButton, UploadForm } from "./upload-form";
import { deleteDocumentAction, uploadDocumentAction } from "./actions";

type Owner = { tenantId: string } | { contractId: string } | { unitId: string } | { paymentId: string } | { purchaseInvoiceId: string };

export async function DocumentsPanel({
  actor,
  owner,
  path,
  categories,
  title = "المستندات والمرفقات",
  canUpload = true,
  canDelete = true,
}: {
  actor: Actor;
  owner: Owner;
  path: string;
  categories: DocumentCategory[];
  title?: string;
  canUpload?: boolean;
  /** إخفاء الحذف (مثل مرفقات فاتورة معتمدة — الخادم يمنعه أيضًا) */
  canDelete?: boolean;
}) {
  const { documents, hiddenSensitive, allowed } = await listDocuments(prisma, actor, owner);
  const upload = canUpload && actor.permissions.has("documents.upload");
  const canSensitive = actor.permissions.has("documents.view_sensitive");
  const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} م.ب` : `${Math.ceil(n / 1024)} ك.ب`);
  return (
    <Card>
      <CardHeader title={title} />
      <div className="space-y-4 p-5">
        {!allowed ? (
          <p className="text-sm text-gray-500">ليست لديك صلاحية عرض المستندات.</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-gray-500">لا توجد مستندات مرفوعة.</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <a href={`/api/documents/${d.id}`} className="font-medium text-brand-700 hover:underline">{d.fileName}</a>
                  <span className="ms-2 text-xs text-gray-400">{kb(d.sizeBytes)} · {formatDateTime(d.createdAt)}</span>
                  <div className="mt-1 flex gap-1.5">
                    <Badge>{DOCUMENT_CATEGORY_LABELS[d.category]}</Badge>
                    {d.isSensitive && <Badge color="red">حساس</Badge>}
                  </div>
                </div>
                {upload && canDelete && <DeleteDocButton action={deleteDocumentAction.bind(null, d.id, path)} />}
              </li>
            ))}
          </ul>
        )}
        {hiddenSensitive > 0 && <p className="text-xs text-gray-500">يوجد {hiddenSensitive} مستند حساس لا تملك صلاحية عرضه.</p>}
        {upload && (
          <div className="border-t border-gray-100 pt-4">
            <UploadForm
              action={uploadDocumentAction.bind(null, owner, path)}
              categories={categories.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }))}
              canSensitive={canSensitive}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
