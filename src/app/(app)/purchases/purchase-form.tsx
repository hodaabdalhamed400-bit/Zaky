"use client";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

/** تحويل نص المبلغ إلى هللات (عدد صحيح) لتجنب أخطاء الكسور العشرية في المعاينة */
const toH = (v: string) => {
  const s = v.replace(/[,،\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
};
const fmt = (h: number) => (h / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 15% من مبلغ شامل الضريبة = الإجمالي × 15 ÷ 115، مقربة لأقرب هللة */
const vatOf = (h: number) => Math.round((h * 15) / 115);

export type PurchaseDefaults = {
  branchId?: string;
  categoryId?: string;
  supplierName?: string;
  supplierVatNo?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  totalAmount?: string;
  vatAmount?: string;
  description?: string;
};

export function PurchaseForm({
  action,
  mode,
  branches,
  categories,
  today,
  defaults = {},
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  mode: "create" | "edit";
  branches: { id: string; nameAr: string }[];
  categories: { id: string; nameAr: string }[];
  today: string;
  defaults?: PurchaseDefaults;
}) {
  const [state, formAction, pending] = useActionForm(action, {});
  const [total, setTotal] = useState(defaults.totalAmount ?? "");
  const [vat, setVat] = useState(defaults.vatAmount ?? "");
  const [vatTouched, setVatTouched] = useState(mode === "edit");

  const totalH = toH(total);
  const vatH = toH(vat);
  const net = totalH !== null && vatH !== null && vatH <= totalH ? totalH - vatH : null;

  const onTotal = (v: string) => {
    setTotal(v);
    const h = toH(v);
    if (!vatTouched && h !== null) setVat((vatOf(h) / 100).toFixed(2));
  };

  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        {mode === "create" && (
          <Field label="الفرع" htmlFor="branchId" required>
            <select id="branchId" name="branchId" required defaultValue={defaults.branchId ?? (branches.length === 1 ? branches[0]!.id : "")} className={inputClass}>
              {branches.length !== 1 && <option value="" disabled>اختر الفرع</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
            </select>
          </Field>
        )}
        <Field label="التصنيف" htmlFor="categoryId" required>
          <select id="categoryId" name="categoryId" required defaultValue={defaults.categoryId ?? ""} className={inputClass}>
            <option value="" disabled>اختر التصنيف</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
          </select>
        </Field>
        <Field label="اسم المورد" htmlFor="supplierName" required>
          <input id="supplierName" name="supplierName" required maxLength={200} defaultValue={defaults.supplierName} className={inputClass} />
        </Field>
        <Field label="الرقم الضريبي للمورد" htmlFor="supplierVatNo" hint="اختياري — 15 رقمًا كما في الفاتورة">
          <input id="supplierVatNo" name="supplierVatNo" dir="ltr" inputMode="numeric" maxLength={20} defaultValue={defaults.supplierVatNo} className={inputClass + " tabular text-start"} placeholder="3xxxxxxxxxxxxx3" />
        </Field>
        <Field label="رقم فاتورة المورد" htmlFor="invoiceNo" required>
          <input id="invoiceNo" name="invoiceNo" required dir="ltr" maxLength={60} defaultValue={defaults.invoiceNo} className={inputClass + " text-start"} />
        </Field>
        <Field label="تاريخ الفاتورة" htmlFor="invoiceDate" required>
          <input id="invoiceDate" name="invoiceDate" type="date" required max={today} defaultValue={defaults.invoiceDate ?? today} className={inputClass + " tabular"} />
        </Field>
      </div>

      <fieldset className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
        <legend className="px-1 text-sm font-semibold text-brand-900">المبالغ كما في فاتورة المورد</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="الإجمالي شامل الضريبة (ر.س)" htmlFor="totalAmount" required>
            <input id="totalAmount" name="totalAmount" required inputMode="decimal" dir="ltr" value={total} onChange={(e) => onTotal(e.target.value)} className={inputClass + " tabular text-start"} placeholder="0.00" />
          </Field>
          <Field label="مبلغ الضريبة (ر.س)" htmlFor="vatAmount" required hint="يُحسب 15% تلقائيًا — عدّله ليطابق الفاتورة، أو 0 إن كان المورد غير مسجل">
            <input
              id="vatAmount"
              name="vatAmount"
              required
              inputMode="decimal"
              dir="ltr"
              value={vat}
              onChange={(e) => {
                setVat(e.target.value);
                setVatTouched(true);
              }}
              className={inputClass + " tabular text-start"}
              placeholder="0.00"
            />
          </Field>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-gray-700">قبل الضريبة</p>
            <p className="tabular rounded-lg bg-white px-3 py-2 text-sm font-semibold text-brand-900 ring-1 ring-gray-200" aria-live="polite">
              {net === null ? "—" : `${fmt(net)} ر.س`}
            </p>
            {vatH !== null && totalH !== null && vatH > totalH && <p className="text-xs text-red-600">الضريبة أكبر من الإجمالي</p>}
          </div>
        </div>
      </fieldset>

      <Field label="الوصف / ملاحظات" htmlFor="description" hint="مثال: صيانة مكيف المكتب 104">
        <textarea id="description" name="description" rows={2} maxLength={1000} defaultValue={defaults.description} className={inputClass} />
      </Field>

      {mode === "create" && (
        <Field label="صورة الفاتورة" htmlFor="file" required hint="PDF أو صورة واضحة، حتى 10 ميجابايت — مطلوبة لاعتماد الفاتورة">
          <input id="file" name="file" type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-sm file:me-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-900" />
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingText="جارٍ الحفظ…">{mode === "create" ? "حفظ وإرسال للمراجعة" : "حفظ وإعادة للمراجعة"}</SubmitButton>
        <Link href="/purchases" className={buttonClass("ghost")}>إلغاء</Link>
      </div>
    </ActionForm>
  );
}

/** نموذج تسجيل دفع الفاتورة للمورد */
export function MarkPaidForm({ action, today, methods }: { action: (p: FormState, fd: FormData) => Promise<FormState>; today: string; methods: { value: string; label: string }[] }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <Field label="وسيلة الدفع" htmlFor="pay-method" required>
        <select id="pay-method" name="method" required defaultValue="" className={inputClass}>
          <option value="" disabled>اختر</option>
          {methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </Field>
      <Field label="تاريخ الدفع" htmlFor="pay-date" required>
        <input id="pay-date" name="paidOn" type="date" required max={today} defaultValue={today} className={inputClass + " tabular"} />
      </Field>
      <SubmitButton className="w-full">تسجيل كمدفوعة</SubmitButton>
    </ActionForm>
  );
}

export function CategoryForm({ action }: { action: (p: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="flex flex-wrap items-end gap-3">
      <div className="min-w-60 flex-1">
        <Field label="تصنيف جديد" htmlFor="nameAr" required>
          <input id="nameAr" name="nameAr" required minLength={2} maxLength={80} className={inputClass} />
        </Field>
      </div>
      <SubmitButton>إضافة</SubmitButton>
      {state.error && <div className="w-full"><Alert>{state.error}</Alert></div>}
      {state.success && <div className="w-full"><Alert kind="success">{state.success}</Alert></div>}
    </ActionForm>
  );
}
