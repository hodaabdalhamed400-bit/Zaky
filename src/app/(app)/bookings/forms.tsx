"use client";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { useState } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/auth/server";

type Room = { id: string; code: string; branchName: string; price: string; priced: boolean };

export function BookingForm({
  action,
  rooms,
  tenants,
  initial,
  today,
}: {
  action: (p: FormState, fd: FormData) => Promise<FormState>;
  rooms: Room[];
  tenants: { id: string; name: string; mobile: string | null }[];
  initial: { unitId?: string; date: string; startHour: number };
  today: string;
}) {
  const [state, formAction, pending] = useActionForm(action, {});
  const [type, setType] = useState<"TENANT" | "VISITOR">("TENANT");
  const [start, setStart] = useState(initial.startHour);
  const [unitId, setUnitId] = useState(initial.unitId ?? "");
  const room = rooms.find((r) => r.id === unitId);
  const hours = Array.from({ length: 14 }, (_, i) => 8 + i);
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <Field label="القاعة" htmlFor="unitId" required hint={room ? (room.priced ? `سعر الساعة: ${room.price} ر.س (شامل الضريبة)` : "سعر القاعة ليس بالساعة — عدّله من بيانات الوحدة") : undefined}>
            <select id="unitId" name="unitId" required value={unitId} onChange={(e) => setUnitId(e.target.value)} className={inputClass}>
              <option value="" disabled>اختر القاعة</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.branchName}</option>)}
            </select>
          </Field>
        </div>
        <Field label="التاريخ" htmlFor="date" required>
          <input id="date" name="date" type="date" min={today} required defaultValue={initial.date} className={inputClass + " tabular"} />
        </Field>
        <Field label="من الساعة" htmlFor="startHour" required>
          <select id="startHour" name="startHour" value={start} onChange={(e) => setStart(Number(e.target.value))} className={inputClass + " tabular"}>
            {hours.map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
        </Field>
        <Field label="المدة (ساعات)" htmlFor="hours" required hint={`حتى ${22 - start} ساعات (الإغلاق 10 مساءً)`}>
          <select id="hours" name="hours" defaultValue={1} key={start} className={inputClass + " tabular"}>
            {Array.from({ length: 22 - start }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      </div>
      <fieldset className="space-y-4 rounded-xl border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-800">العميل</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="customerType" value="TENANT" checked={type === "TENANT"} onChange={() => setType("TENANT")} className="accent-brand-700" /> مستأجر (ساعتان مجانيتان يوميًا مع عقد نشط)</label>
          <label className="flex items-center gap-2"><input type="radio" name="customerType" value="VISITOR" checked={type === "VISITOR"} onChange={() => setType("VISITOR")} className="accent-brand-700" /> زائر خارجي (بسعر الساعة)</label>
        </div>
        {type === "TENANT" ? (
          <Field label="المستأجر" htmlFor="tenantId" required>
            <select id="tenantId" name="tenantId" required defaultValue="" className={inputClass}>
              <option value="" disabled>اختر المستأجر</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}{t.mobile ? ` — ${t.mobile}` : ""}</option>)}
            </select>
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم الزائر" htmlFor="visitorName" required><input id="visitorName" name="visitorName" required maxLength={120} className={inputClass} /></Field>
            <Field label="جوال الزائر" htmlFor="visitorMobile"><input id="visitorMobile" name="visitorMobile" dir="ltr" inputMode="tel" className={inputClass + " text-start"} /></Field>
          </div>
        )}
      </fieldset>
      <Field label="ملاحظات" htmlFor="notes"><input id="notes" name="notes" maxLength={1000} className={inputClass} /></Field>
      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-gray-500">يحسب النظام الساعات المجانية والمبلغ تلقائيًا عند الحفظ.</p>
        <SubmitButton>تأكيد الحجز</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function BookingPaymentForm({ action, idempotencyKey, today }: { action: (p: FormState, fd: FormData) => Promise<FormState>; idempotencyKey: string; today: string }) {
  const [state, formAction, pending] = useActionForm(action, {});
  const [method, setMethod] = useState("CASH");
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="الوسيلة" htmlFor="bp-method" required>
          <select id="bp-method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
            <option value="CASH">نقد</option>
            <option value="CARD">شبكة / مدى</option>
            <option value="BANK_TRANSFER">تحويل بنكي</option>
            <option value="OTHER">أخرى</option>
          </select>
        </Field>
        <Field label="رقم المرجع" htmlFor="bp-ref" required={method === "BANK_TRANSFER"}>
          <input id="bp-ref" name="referenceNo" dir="ltr" required={method === "BANK_TRANSFER"} className={inputClass + " text-start"} />
        </Field>
        <Field label="تاريخ الدفع" htmlFor="bp-date" required>
          <input id="bp-date" name="paidOn" type="date" max={today} defaultValue={today} required className={inputClass + " tabular"} />
        </Field>
      </div>
      <SubmitButton variant="secondary">تسجيل الدفعة (بانتظار الاعتماد)</SubmitButton>
    </ActionForm>
  );
}
