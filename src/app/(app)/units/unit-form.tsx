"use client";
import { useActionState, useState } from "react";
import { Alert, Field, buttonClass, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import type { FormState } from "@/lib/auth/server";

type BranchOpt = { id: string; nameAr: string; floors: { id: string; name: string }[] };
type TypeOpt = { id: string; nameAr: string; occupancyMode: "EXCLUSIVE" | "SHARED"; isActive: boolean };
export type UnitInitial = {
  branchId: string;
  floorId: string | null;
  unitTypeId: string;
  code: string;
  areaSqm: string | null;
  capacity: number;
  basePrice: string;
  pricingCycle: string;
  description: string | null;
  status: string;
};

export function UnitForm({
  mode,
  action,
  branches,
  types,
  initial,
  defaultBranchId,
}: {
  mode: "create" | "edit";
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  branches: BranchOpt[];
  types: TypeOpt[];
  initial?: UnitInitial;
  defaultBranchId?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const [branchId, setBranchId] = useState(initial?.branchId ?? defaultBranchId ?? (branches.length === 1 ? branches[0]!.id : ""));
  const [typeId, setTypeId] = useState(initial?.unitTypeId ?? "");
  const floors = branches.find((b) => b.id === branchId)?.floors ?? [];
  const type = types.find((t) => t.id === typeId);
  const selectableTypes = types.filter((t) => t.isActive || t.id === initial?.unitTypeId);

  return (
    <form action={formAction} className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="الفرع" htmlFor="branchId" required>
          <select id="branchId" name="branchId" required value={branchId} onChange={(e) => setBranchId(e.target.value)} className={inputClass}>
            <option value="" disabled>اختر الفرع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </select>
        </Field>
        <Field label="الدور" htmlFor="floorId" hint={branchId && floors.length === 0 ? "لا توجد أدوار مسجلة لهذا الفرع (اختياري)" : undefined}>
          <select id="floorId" name="floorId" defaultValue={initial?.floorId ?? ""} key={branchId} className={inputClass} disabled={floors.length === 0}>
            <option value="">بدون</option>
            {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="رقم المكتب / الوحدة" htmlFor="code" required>
          <input id="code" name="code" required maxLength={30} defaultValue={initial?.code} className={inputClass} placeholder="مثال: 101" />
        </Field>
        <Field
          label="نوع الوحدة"
          htmlFor="unitTypeId"
          required
          hint={type ? (type.occupancyMode === "SHARED" ? "مشتركة: تُؤجر بالمقاعد حتى السعة" : "حصرية: تُؤجر لعقد واحد في الفترة") : undefined}
        >
          <select id="unitTypeId" name="unitTypeId" required value={typeId} onChange={(e) => setTypeId(e.target.value)} className={inputClass}>
            <option value="" disabled>اختر النوع</option>
            {selectableTypes.map((t) => <option key={t.id} value={t.id}>{t.nameAr}</option>)}
          </select>
        </Field>
        <Field label="المساحة (م²)" htmlFor="areaSqm" hint="مطلوبة لحساب الإشغال حسب المساحة">
          <input id="areaSqm" name="areaSqm" inputMode="decimal" dir="ltr" defaultValue={initial?.areaSqm ?? ""} className={inputClass + " tabular text-start"} placeholder="0.00" />
        </Field>
        <Field label={type?.occupancyMode === "SHARED" ? "عدد المقاعد" : "السعة الاستيعابية"} htmlFor="capacity" required>
          <input id="capacity" name="capacity" type="number" min={1} max={1000} required defaultValue={initial?.capacity ?? 1} className={inputClass + " tabular"} />
        </Field>
        <Field label="السعر الأساسي (ر.س، شامل الضريبة)" htmlFor="basePrice" required>
          <input id="basePrice" name="basePrice" inputMode="decimal" dir="ltr" required defaultValue={initial?.basePrice ?? ""} className={inputClass + " tabular text-start"} placeholder="0.00" />
        </Field>
        <Field label="دورة التسعير" htmlFor="pricingCycle" required>
          <select id="pricingCycle" name="pricingCycle" defaultValue={initial?.pricingCycle ?? "MONTH"} className={inputClass}>
            <option value="HOUR">بالساعة</option>
            <option value="DAY">باليوم</option>
            <option value="MONTH">بالشهر</option>
            <option value="YEAR">بالسنة</option>
          </select>
        </Field>
        <Field label="الحالة التشغيلية" htmlFor="status" required hint="«مؤجرة» تُحدد تلقائيًا من العقود النشطة">
          <select id="status" name="status" defaultValue={initial?.status === "RENTED" ? "AVAILABLE" : (initial?.status ?? "AVAILABLE")} className={inputClass}>
            <option value="AVAILABLE">متاحة</option>
            <option value="RESERVED">محجوزة</option>
            <option value="MAINTENANCE">صيانة</option>
            <option value="INACTIVE">غير نشطة</option>
          </select>
        </Field>
        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="الوصف" htmlFor="description">
            <textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={initial?.description ?? ""} className={inputClass} placeholder="مثال: إطلالة خارجية، مكتبان، خزانة…" />
          </Field>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {mode === "create" && (
          <button type="submit" name="another" value="1" className={buttonClass("secondary")}>حفظ وإضافة أخرى</button>
        )}
        <SubmitButton>{mode === "create" ? "حفظ الوحدة" : "حفظ التعديلات"}</SubmitButton>
      </div>
    </form>
  );
}

export function ArchiveUnitForm({ action, archived }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; archived: boolean }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <p className="text-sm text-gray-500">
        {archived
          ? "الوحدة مؤرشفة: لا تظهر في القوائم ولا تُحتسب في الإشغال، وسجلها محفوظ."
          : "الأرشفة بديل الحذف: تُخفي الوحدة من القوائم والإشغال مع حفظ سجلها. لا يمكن أرشفة وحدة عليها عقد ساري أو قادم."}
      </p>
      <ConfirmButton message={archived ? "استعادة الوحدة؟" : "أرشفة هذه الوحدة؟"} variant={archived ? "secondary" : "danger"}>
        {archived ? "استعادة الوحدة" : "أرشفة الوحدة"}
      </ConfirmButton>
    </form>
  );
}
