"use client";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { Alert, Badge, buttonClass, cx } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import type { ImportState } from "./actions";

const fmt = (v: string | null) => (v === null ? "—" : Number(v).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function ImportForm({ action, branchId, branchName }: { action: (p: ImportState, fd: FormData) => Promise<ImportState>; branchId: string; branchName: string }) {
  const [state, onSubmit, pending] = useActionForm(action, {} as ImportState);
  const [picked, setPicked] = useState<string | null>(null);
  const [only, setOnly] = useState<"all" | "error" | "warning">("all");
  const p = state.preview;
  const r = state.result;
  const fresh = !!p && state.fileName === picked;

  return (
    <ActionForm onSubmit={onSubmit} pending={pending} className="space-y-6" data-import-form>
      {/* الخطوات */}
      <ol className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["1", "ارفع الملف", "شيت «بيانات الفرع» بعد تعبئته (‎.xlsx‎)"],
          ["2", "راجع المعاينة", "الأخطاء تمنع الاستيراد، والتنبيهات للمراجعة فقط"],
          ["3", "استورد", "تُضاف الوحدات والعملاء والعقود المعتمدة والمسدد"],
        ].map(([n, t, d], i) => (
          <li key={n} className={cx("flex gap-3 rounded-xl p-3 ring-1", (i === 0 && !p && !r) || (i === 1 && p && !r) || (i === 2 && r) ? "bg-brand-50 ring-brand-200" : "bg-gray-50 ring-gray-200")}>
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-900 text-xs font-bold text-white">{n}</span>
            <span>
              <b className="block text-gray-900">{t}</b>
              <span className="text-xs text-gray-500">{d}</span>
            </span>
          </li>
        ))}
      </ol>

      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/60 p-8 text-center transition hover:border-brand-400 hover:bg-brand-50/40">
        <Icon name="receipt" className="size-8 text-brand-700" />
        <span className="text-sm font-semibold text-gray-900">{picked ?? "اختر ملف Excel لفرع " + branchName}</span>
        <span className="text-xs text-gray-500">حتى 5 ميجابايت · لا يُحفظ شيء قبل ضغط «استيراد الآن»</span>
        <input
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          className="sr-only"
          onChange={(e) => setPicked(e.currentTarget.files?.[0]?.name ?? null)}
          data-import-file
        />
      </label>

      {state.error && <Alert>{state.error}</Alert>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" name="intent" value="preview" disabled={pending || !picked} className={buttonClass(p ? "secondary" : "primary")}>
          {pending ? "جارٍ القراءة…" : p ? "إعادة المعاينة" : "معاينة الملف"}
        </button>
        {fresh && p.errors === 0 && !r && (
          <button
            type="submit"
            name="intent"
            value="commit"
            disabled={pending}
            className={buttonClass("primary")}
            onClick={(e) => {
              if (!confirm(`سيتم تسجيل بيانات ${p.branch.name} في النظام. متابعة؟`)) e.preventDefault();
            }}
            data-import-commit
          >
            {pending ? "جارٍ الاستيراد…" : "استيراد الآن"}
          </button>
        )}
        {fresh && p.errors > 0 && p.blocking === 0 && !r && p.ready.units + p.ready.tenants + p.ready.contracts > 0 && (
          <button
            type="submit"
            name="intent"
            value="partial"
            disabled={pending}
            className={buttonClass("primary")}
            onClick={(e) => {
              if (!confirm(`سيتم تسجيل السطور السليمة فقط: ${p.ready.units} وحدة، ${p.ready.tenants} عميل، ${p.ready.contracts} عقد.\nالسطور التي فيها أخطاء تُترك، وتُضاف عند رفع الملف بعد تصحيحه. متابعة؟`)) e.preventDefault();
            }}
            data-import-partial
          >
            {pending ? "جارٍ الاستيراد…" : `استيراد السليم فقط (${p.ready.units} وحدة · ${p.ready.tenants} عميل · ${p.ready.contracts} عقد)`}
          </button>
        )}
      </div>

      {r && (
        <div className="animate-fade-up space-y-3" data-import-result>
          <Alert kind={r.failed.length ? "warning" : "success"}>
            تم الاستيراد: {r.units} وحدة، {r.tenants} عميل، {r.contracts} عقد معتمد، {r.payments} دفعة مسددة{r.floors ? `، و${r.floors} دور جديد` : ""}.
            {r.failed.length > 0 && " بعض العقود لم تُسجل — التفاصيل بالأسفل. صحح الملف وارفعه مرة أخرى: ما تم تسجيله لن يتكرر."}
          </Alert>
          {r.failed.length > 0 && (
            <ul className="space-y-1 text-sm text-red-700">
              {r.failed.map((f) => (
                <li key={f.ref}>
                  {f.ref}: {f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href={`/branches/${branchId}`} className={buttonClass("secondary")}>بيانات الفرع</Link>
            <Link href={`/units?branchId=${branchId}`} className={buttonClass("secondary")}>الوحدات</Link>
            <Link href="/contracts" className={buttonClass("secondary")}>العقود</Link>
            <Link href={`/branches/${branchId}/3d`} className={buttonClass("secondary")}>المجسم 3D</Link>
          </div>
        </div>
      )}

      {p && !r && (
        <div className="animate-fade-up space-y-5" data-import-preview>
          {!fresh && <Alert kind="info">اخترت ملفًا جديدًا — اضغط «إعادة المعاينة» قبل الاستيراد.</Alert>}
          {p.blocking > 0 ? (
            <Alert kind="error">{p.issues.find((i) => i.blocking)?.message}</Alert>
          ) : p.errors > 0 ? (
            <Alert kind="warning">
              في الملف <b>{p.errors}</b> خطأ{p.warnings ? ` و${p.warnings} تنبيه` : ""}. يمكنك <b>استيراد السليم فقط</b> الآن (المؤجَّل يظهر بعلامة «مؤجل» بالأسفل)، ثم رفع الملف نفسه بعد تصحيحه لاحقًا: يُضاف الناقص فقط دون تكرار.
            </Alert>
          ) : (
            <Alert kind="success">الملف سليم{p.warnings ? ` — مع ${p.warnings} تنبيه راجعها قبل الاستيراد` : ""}. اضغط «استيراد الآن».</Alert>
          )}

          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["الوحدات", p.ready.units, p.units.filter((u) => u.action === "skip").length, "units"],
              ["العملاء", p.ready.tenants, p.tenants.filter((t) => t.action === "skip").length, "tenants"],
              ["العقود", p.ready.contracts, p.contracts.filter((c) => c.action === "skip").length, "contracts"],
              ["أدوار جديدة", p.floors.length, 0, "branches"],
            ].map(([label, n, skipped, icon]) => (
              <div key={label as string} className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  {label}
                  <Icon name={icon as "units"} className="size-4 text-brand-600" />
                </div>
                <p className="tabular mt-1 text-2xl font-bold text-brand-900">{n as number}</p>
                <p className="text-[11px] text-gray-400">جاهزة للإضافة{(skipped as number) > 0 ? ` · ${skipped} مؤجلة لوجود أخطاء` : ""}</p>
              </div>
            ))}
          </div>

          {p.issues.length > 0 && (
            <section>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-gray-900">ملاحظات المراجعة</h3>
                {(["all", "error", "warning"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setOnly(k)}
                    className={cx("rounded-full px-3 py-1 text-xs ring-1", only === k ? "bg-brand-900 text-white ring-brand-900" : "bg-white text-gray-600 ring-gray-200")}
                  >
                    {k === "all" ? `الكل (${p.issues.length})` : k === "error" ? `أخطاء (${p.errors})` : `تنبيهات (${p.warnings})`}
                  </button>
                ))}
              </div>
              <div className="max-h-96 overflow-auto rounded-xl ring-1 ring-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-start font-medium">النوع</th>
                      <th className="px-3 py-2 text-start font-medium">الشيت</th>
                      <th className="px-3 py-2 text-start font-medium">السطر</th>
                      <th className="px-3 py-2 text-start font-medium">الملاحظة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {p.issues
                      .filter((i) => only === "all" || i.level === only)
                      .map((i, k) => (
                        <tr key={k} className={i.level === "error" ? "bg-red-50/40" : ""}>
                          <td className="px-3 py-2">{i.level === "error" ? <Badge color="red">خطأ</Badge> : <Badge color="amber">تنبيه</Badge>}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-gray-600">{i.sheet}</td>
                          <td className="tabular px-3 py-2 text-gray-500">{i.row ?? "—"}</td>
                          <td className="px-3 py-2 text-gray-900">{i.message}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {p.contracts.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-bold text-gray-900">العقود كما ستُسجل</h3>
              <div className="overflow-x-auto rounded-xl ring-1 ring-gray-200">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      {["المرجع", "العميل", "الوحدات", "البداية", "النهاية", "الدفع", "الإيجار الشهري", "إجمالي العقد", "المسدد", ""].map((h) => (
                        <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {p.contracts.map((c) => (
                      <tr key={c.ref}>
                        <td className="px-3 py-2 text-gray-500">{c.ref}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{c.tenant || "—"}</td>
                        <td className="px-3 py-2">{c.units.join("، ")}</td>
                        <td className="tabular px-3 py-2">{c.start ?? "—"}</td>
                        <td className="tabular px-3 py-2">{c.end ?? "—"}</td>
                        <td className="px-3 py-2">{c.cycle ?? "—"}</td>
                        <td className="tabular px-3 py-2">{fmt(c.monthly)}</td>
                        <td className="tabular px-3 py-2">{fmt(c.total)}</td>
                        <td className="tabular px-3 py-2">{fmt(c.paid)}</td>
                        <td className="px-3 py-2">{c.action === "exists" ? <Badge>مسجل مسبقًا</Badge> : c.action === "skip" ? <Badge color="amber">مؤجل</Badge> : <Badge color="green">جديد</Badge>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <details className="rounded-xl ring-1 ring-gray-200">
            <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-gray-900">الوحدات ({p.units.length}) والعملاء ({p.tenants.length})</summary>
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <ul className="divide-y divide-gray-100 text-sm">
                {p.units.map((u) => (
                  <li key={u.code} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      <b>{u.code}</b> <span className="text-gray-500">· {u.type}{u.floor ? ` · ${u.floor}` : ""} · {u.status}</span>
                    </span>
                    <span className="tabular text-xs text-gray-600">{u.action === "skip" ? <Badge color="amber">مؤجلة</Badge> : <>{fmt(u.price)} / {u.cycle}{u.action === "exists" && " · مسجلة"}</>}</span>
                  </li>
                ))}
              </ul>
              <ul className="divide-y divide-gray-100 text-sm">
                {p.tenants.map((t) => (
                  <li key={t.name} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      <b>{t.name}</b> <span className="text-gray-500">· {t.type} · {t.status}</span>
                    </span>
                    <span className="tabular text-xs text-gray-600" dir="ltr">{t.action === "skip" ? <Badge color="amber">مؤجل</Badge> : <>{t.mobile ?? "—"}{t.action === "exists" && " · مسجل"}</>}</span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      )}
    </ActionForm>
  );
}
