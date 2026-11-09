"use client";
import { useActionState, useMemo, useState } from "react";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

type UnitOpt = { id: string; code: string; branchId: string; capacity: number; occupancyMode: "EXCLUSIVE" | "SHARED"; basePrice: string; pricingCycle: string; status: string; unitType: { nameAr: string } };
type Line = { unitId: string; seats: number; monthlyPrice: string };
export type ContractInitial = {
  tenantId: string; branchId: string; startDate: string; durationMonths: number; billingCycle: string; discountAmount: string; terms: string | null; notes: string | null; units: Line[];
};

// معاينة فورية بالهللات (أعداد صحيحة) — الحساب النهائي المعتمد يتم على الخادم
const toHalalas = (v: string) => {
  const s = v.replace(/[,،\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
};
const fmt = (h: number) => `${(h / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

function suggestPrice(u: UnitOpt, seats: number) {
  const b = toHalalas(u.basePrice) ?? 0;
  const m = u.pricingCycle === "MONTH" ? b : u.pricingCycle === "YEAR" ? Math.round(b / 12) : 0;
  const total = u.occupancyMode === "SHARED" ? m * seats : m;
  return total ? (total / 100).toFixed(2) : "";
}

const CYCLE: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, ANNUAL: 12 };

export function ContractForm({
  action,
  branches,
  tenants,
  units,
  initial,
  defaultTenantId,
  lockBranch,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  branches: { id: string; nameAr: string }[];
  tenants: { id: string; name: string; mobile: string | null; primaryBranchId: string | null }[];
  units: UnitOpt[];
  initial?: ContractInitial;
  defaultTenantId?: string;
  lockBranch?: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const defTenant = tenants.find((t) => t.id === (initial?.tenantId ?? defaultTenantId));
  const [branchId, setBranchId] = useState(initial?.branchId ?? defTenant?.primaryBranchId ?? (branches.length === 1 ? branches[0]!.id : ""));
  const [lines, setLines] = useState<Line[]>(initial?.units ?? []);
  const [months, setMonths] = useState(String(initial?.durationMonths ?? 12));
  const [cycle, setCycle] = useState(initial?.billingCycle ?? "MONTHLY");
  const [discount, setDiscount] = useState(initial?.discountAmount ?? "0");
  const [pick, setPick] = useState("");

  const branchUnits = units.filter((u) => u.branchId === branchId);
  const byId = new Map(units.map((u) => [u.id, u]));
  const available = branchUnits.filter((u) => !lines.some((l) => l.unitId === u.id));

  const preview = useMemo(() => {
    const m = Number(months);
    const prices = lines.map((l) => toHalalas(l.monthlyPrice));
    if (!lines.length || prices.some((p) => p === null) || !Number.isInteger(m) || m < 1) return null;
    const monthly = (prices as number[]).reduce((a, b) => a + b, 0);
    const rent = monthly * m;
    const disc = toHalalas(discount || "0");
    if (disc === null || disc > rent) return { monthly, rent, error: "الخصم غير صحيح أو أكبر من قيمة العقد" };
    const total = rent - disc;
    // نفس طريقة الخادم: ضريبة كل قسط تُقرّب على حدة، وضريبة العقد = مجموعها
    const c = CYCLE[cycle] ?? 1;
    const count = Math.ceil(m / c);
    let left = disc;
    let vat = 0;
    for (let i = 0; i < count; i++) {
      const gross = monthly * Math.min(c, m - i * c);
      const d = i === count - 1 ? left : Math.round((disc * gross) / rent);
      left -= d;
      const amt = gross - d;
      vat += amt - Math.round(amt / 1.15);
    }
    return { monthly, rent, total, vat, installments: count, perInstallment: Math.round((total * Math.min(c, m)) / m) };
  }, [lines, months, discount, cycle]);

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={formAction} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="units" value={JSON.stringify(lines)} />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="الفرع" htmlFor="branchId" required hint={lockBranch ? "لا يمكن تغيير فرع العقد بعد إنشائه" : undefined}>
          <select
            id="branchId"
            name="branchId"
            required
            value={branchId}
            disabled={lockBranch}
            onChange={(e) => {
              setBranchId(e.target.value);
              setLines([]);
            }}
            className={inputClass}
          >
            <option value="" disabled>اختر الفرع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
          {lockBranch && <input type="hidden" name="branchId" value={branchId} />}
        </Field>
        <div className="lg:col-span-2">
          <Field label="المستأجر" htmlFor="tenantId" required>
            <select id="tenantId" name="tenantId" required defaultValue={initial?.tenantId ?? defaultTenantId ?? ""} className={inputClass}>
              <option value="" disabled>اختر المستأجر</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.mobile ? ` — ${t.mobile}` : ""}</option>)}
            </select>
          </Field>
        </div>
        <Field label="تاريخ البداية" htmlFor="startDate" required hint="القسط يستحق في نفس اليوم من كل دورة">
          <input id="startDate" name="startDate" type="date" required defaultValue={initial?.startDate} className={inputClass + " tabular"} />
        </Field>
        <Field label="المدة (بالأشهر)" htmlFor="durationMonths" required>
          <input id="durationMonths" name="durationMonths" type="number" min={1} max={60} required value={months} onChange={(e) => setMonths(e.target.value)} className={inputClass + " tabular"} />
        </Field>
        <Field label="دورة الدفع" htmlFor="billingCycle" required>
          <select id="billingCycle" name="billingCycle" value={cycle} onChange={(e) => setCycle(e.target.value)} className={inputClass}>
            <option value="MONTHLY">شهري</option>
            <option value="QUARTERLY">ربع سنوي</option>
            <option value="SEMI_ANNUAL">نصف سنوي</option>
            <option value="ANNUAL">سنوي</option>
          </select>
        </Field>
      </div>

      <fieldset className="rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-800">الوحدات المؤجرة</legend>
        {!branchId ? (
          <p className="text-sm text-gray-500">اختر الفرع أولًا.</p>
        ) : (
          <div className="space-y-3">
            {lines.length === 0 && <p className="text-sm text-gray-500">لم تُضف وحدات بعد.</p>}
            {lines.map((l, i) => {
              const u = byId.get(l.unitId);
              if (!u) return null;
              return (
                <div key={l.unitId} className="grid items-end gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-[1fr_7rem_10rem_auto]">
                  <div>
                    <p className="font-medium text-gray-900">{u.code} <span className="text-xs font-normal text-gray-500">— {u.unitType.nameAr}{u.occupancyMode === "SHARED" ? ` (سعة ${u.capacity} مقعد)` : ""}</span></p>
                    {u.status !== "AVAILABLE" && <p className="text-xs text-amber-700">الحالة التشغيلية: {u.status === "RESERVED" ? "محجوزة" : u.status === "MAINTENANCE" ? "صيانة" : u.status}</p>}
                  </div>
                  {u.occupancyMode === "SHARED" ? (
                    <Field label="المقاعد" htmlFor={`seats-${i}`}>
                      <input id={`seats-${i}`} type="number" min={1} max={u.capacity} value={l.seats} onChange={(e) => update(i, { seats: Number(e.target.value) || 1 })} className={inputClass + " tabular"} />
                    </Field>
                  ) : <div className="hidden sm:block" />}
                  <Field label="الإيجار الشهري (شامل الضريبة)" htmlFor={`price-${i}`}>
                    <input id={`price-${i}`} inputMode="decimal" dir="ltr" value={l.monthlyPrice} onChange={(e) => update(i, { monthlyPrice: e.target.value })} className={inputClass + " tabular text-start"} />
                  </Field>
                  <button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className={buttonClass("ghost", "text-red-600")} aria-label={`إزالة الوحدة ${u.code}`}>إزالة</button>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <label htmlFor="pick-unit" className="sr-only">إضافة وحدة</label>
              <select id="pick-unit" value={pick} onChange={(e) => setPick(e.target.value)} className={inputClass + " max-w-sm"}>
                <option value="">{available.length ? "اختر وحدة لإضافتها…" : "لا توجد وحدات أخرى في هذا الفرع"}</option>
                {available.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.unitType.nameAr}</option>)}
              </select>
              <button
                type="button"
                disabled={!pick}
                onClick={() => {
                  const u = byId.get(pick);
                  if (!u) return;
                  setLines((ls) => [...ls, { unitId: u.id, seats: 1, monthlyPrice: suggestPrice(u, 1) }]);
                  setPick("");
                }}
                className={buttonClass("secondary")}
              >
                إضافة الوحدة
              </button>
            </div>
          </div>
        )}
      </fieldset>

      <div className="grid gap-5 lg:grid-cols-3">
        <Field label="الخصم على إجمالي العقد (ر.س)" htmlFor="discountAmount" hint="يُوزَّع على الأقساط بنسبة قيمتها">
          <input id="discountAmount" name="discountAmount" inputMode="decimal" dir="ltr" value={discount} onChange={(e) => setDiscount(e.target.value)} className={inputClass + " tabular text-start"} />
        </Field>
        <div className="rounded-xl bg-brand-50 p-4 text-sm lg:col-span-2" aria-live="polite">
          <p className="mb-2 font-semibold text-brand-900">ملخص العقد (معاينة)</p>
          {!preview ? (
            <p className="text-gray-500">أضف وحدة وأدخل السعر والمدة لعرض الملخص.</p>
          ) : "error" in preview && preview.error ? (
            <p className="text-red-700">{preview.error}</p>
          ) : (
            <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-1">
              <dt className="text-gray-600">الإيجار الشهري</dt><dd>{fmt(preview.monthly)}</dd>
              <dt className="text-gray-600">قبل الخصم</dt><dd>{fmt(preview.rent)}</dd>
              <dt className="font-semibold text-gray-900">الإجمالي شامل الضريبة</dt><dd className="font-semibold">{fmt(preview.total!)}</dd>
              <dt className="text-gray-600">منها ضريبة 15%</dt><dd>{fmt(preview.vat!)}</dd>
              <dt className="text-gray-600">عدد الأقساط</dt><dd>{preview.installments} × نحو {fmt(preview.perInstallment!)}</dd>
            </dl>
          )}
          <p className="mt-2 text-xs text-gray-500">لا يوجد تأمين في عقود ذكي. الأرقام النهائية يحسبها النظام عند الحفظ.</p>
        </div>
      </div>

      <Field label="الشروط الخاصة" htmlFor="terms">
        <textarea id="terms" name="terms" rows={4} maxLength={10000} defaultValue={initial?.terms ?? ""} className={inputClass} />
      </Field>
      <Field label="ملاحظات داخلية" htmlFor="notes">
        <textarea id="notes" name="notes" rows={2} maxLength={3000} defaultValue={initial?.notes ?? ""} className={inputClass} />
      </Field>
      <div className="flex justify-end"><SubmitButton>حفظ كمسودة</SubmitButton></div>
    </form>
  );
}

export function TermsForm({ action, terms, notes }: { action: (p: FormState, fd: FormData) => Promise<FormState>; terms: string | null; notes: string | null }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      <Alert kind="info">العقد معتمد: يمكن تعديل الشروط والملاحظات فقط، وتُحفظ نسخة جديدة. التعديل المالي يتطلب عقدًا جديدًا أو تجديدًا.</Alert>
      <Field label="الشروط الخاصة" htmlFor="terms"><textarea id="terms" name="terms" rows={6} maxLength={10000} defaultValue={terms ?? ""} className={inputClass} /></Field>
      <Field label="ملاحظات داخلية" htmlFor="notes"><textarea id="notes" name="notes" rows={2} maxLength={3000} defaultValue={notes ?? ""} className={inputClass} /></Field>
      <Field label="سبب التعديل" htmlFor="reason" required><input id="reason" name="reason" required minLength={3} maxLength={500} className={inputClass} /></Field>
      <div className="flex justify-end"><SubmitButton>حفظ نسخة جديدة</SubmitButton></div>
    </form>
  );
}
