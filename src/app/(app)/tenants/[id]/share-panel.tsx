"use client";
import { useActionState, useState } from "react";
import { Alert, buttonClass, inputClass } from "@/components/ui/primitives";
import type { FormState } from "@/lib/auth/server";
import type { ShareState } from "../actions";

type Link = { id: string; createdAt: string; expiresAt: string; viewCount: number; lastViewedAt: string | null; by: string };

const fmt = (iso: string) => new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { dateStyle: "medium", timeZone: "Asia/Riyadh" }).format(new Date(iso));

/** رابط صفحة المستأجر: إنشاء، نسخ، إرسال واتساب، وإلغاء. الرابط يظهر مرة وحدة فقط عند إنشائه. */
export function SharePanel({
  tenantName,
  whatsapp,
  links,
  create,
  revoke,
}: {
  tenantName: string;
  whatsapp: string | null;
  links: Link[];
  create: (p: ShareState, fd: FormData) => Promise<ShareState>;
  revoke: (p: FormState) => Promise<FormState>;
}) {
  const [state, createAction] = useActionState(create, {});
  const [rState, revokeAction] = useActionState(revoke, {});
  const [copied, setCopied] = useState(false);
  const message = state.url
    ? `هلا ${tenantName}، تقدر تتابع عقودك وأقساطك ودفعاتك لدى ذكي من هذا الرابط:\n${state.url}`
    : "";

  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-gray-500">
        رابط سري يفتحه المستأجر بدون حساب، ويشوف فيه عقوده وأقساطه ودفعاته المعتمدة فقط (عرض بدون تعديل). تقدر تلغيه في أي وقت.
      </p>
      {state.error && <Alert>{state.error}</Alert>}
      {rState.error && <Alert>{rState.error}</Alert>}
      {rState.success && <Alert kind="success">{rState.success}</Alert>}

      {state.url ? (
        <div className="animate-scale-in space-y-3 rounded-xl border border-accent-100 bg-accent-50/50 p-4">
          <p className="text-sm font-medium text-brand-900">الرابط جاهز — انسخه الحين، ما راح يظهر مرة ثانية:</p>
          <input readOnly value={state.url} dir="ltr" onFocus={(e) => e.currentTarget.select()} className={inputClass + " font-mono text-xs"} aria-label="رابط صفحة المستأجر" />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonClass("secondary")}
              onClick={async () => {
                await navigator.clipboard.writeText(state.url!).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "تم النسخ ✓" : "نسخ الرابط"}
            </button>
            {whatsapp && (
              <a
                href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-l from-emerald-500 to-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:brightness-110"
              >
                إرسال على واتساب
              </a>
            )}
          </div>
        </div>
      ) : (
        <form action={createAction} className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600">مدة الرابط</span>
            <select name="days" defaultValue="30" className={inputClass.replace("w-full", "w-40")}>
              <option value="7">أسبوع</option>
              <option value="30">شهر</option>
              <option value="90">3 أشهر</option>
            </select>
          </label>
          <button className={buttonClass("primary")}>إنشاء رابط</button>
        </form>
      )}

      {links.length > 0 && (
        <div className="space-y-2 border-t border-gray-100 pt-4">
          <p className="text-xs font-medium text-gray-500">روابط فعّالة ({links.length})</p>
          <ul className="space-y-1.5 text-xs text-gray-600">
            {links.map((l) => (
              <li key={l.id}>
                أنشأه {l.by} في {fmt(l.createdAt)} · ينتهي {fmt(l.expiresAt)} · فُتح {l.viewCount} مرة{l.lastViewedAt ? ` (آخرها ${fmt(l.lastViewedAt)})` : ""}
              </li>
            ))}
          </ul>
          <form action={revokeAction}>
            <button className={buttonClass("danger")} onClick={(e) => { if (!confirm("إلغاء كل روابط هذا المستأجر؟ الروابط المرسلة راح تتوقف فورًا.")) e.preventDefault(); }}>
              إلغاء كل الروابط
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
