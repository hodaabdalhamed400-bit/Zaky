"use client";
import { ActionForm, useActionForm } from "@/components/ui/action-form";
import { useState } from "react";
import { Alert, Field, inputClass } from "@/components/ui/primitives";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "./actions";

type Role = { id: string; key: string; nameAr: string; allBranches: boolean };
type Branch = { id: string; nameAr: string; code: string };

export function UserForm({
  mode,
  action,
  roles,
  branches,
  initial,
  isSelf,
}: {
  mode: "create" | "edit";
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  roles: Role[];
  branches: Branch[];
  initial?: { email: string; name: string; phone: string | null; roleId: string; branchIds: string[]; isActive: boolean };
  isSelf?: boolean;
}) {
  const [state, formAction, pending] = useActionForm(action, {});
  const [roleId, setRoleId] = useState(initial?.roleId ?? "");
  const role = roles.find((r) => r.id === roleId);

  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-5">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="الاسم الكامل" htmlFor="name" required>
          <input id="name" name="name" required maxLength={120} defaultValue={initial?.name} className={inputClass} />
        </Field>
        <Field label="البريد الإلكتروني" htmlFor="email" required={mode === "create"} hint={mode === "edit" ? "لا يمكن تغيير البريد" : undefined}>
          <input
            id="email"
            name="email"
            type="email"
            dir="ltr"
            required
            disabled={mode === "edit"}
            defaultValue={initial?.email}
            className={inputClass + " text-start"}
          />
        </Field>
        <Field label="رقم الجوال" htmlFor="phone">
          <input id="phone" name="phone" dir="ltr" inputMode="tel" defaultValue={initial?.phone ?? ""} className={inputClass + " text-start"} placeholder="+9665XXXXXXXX" />
        </Field>
        <Field label="الدور" htmlFor="roleId" required hint={isSelf ? "لا يمكنك تغيير دورك بنفسك" : undefined}>
          <select
            id="roleId"
            name="roleId"
            required
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            disabled={isSelf}
            className={inputClass}
          >
            <option value="" disabled>اختر الدور</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.nameAr}</option>
            ))}
          </select>
          {isSelf && <input type="hidden" name="roleId" value={roleId} />}
        </Field>
        {mode === "create" && (
          <Field label="كلمة مرور مؤقتة" htmlFor="password" required hint="10 أحرف على الأقل تتضمن أحرفًا وأرقامًا. سيُطلب من المستخدم تغييرها عند أول دخول.">
            <input id="password" name="password" type="password" dir="ltr" autoComplete="new-password" required minLength={10} className={inputClass} />
          </Field>
        )}
      </div>

      <fieldset className="rounded-lg border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium text-gray-700">الفروع المصرح بها</legend>
        {role?.allBranches ? (
          <p className="text-sm text-gray-500">هذا الدور يغطي جميع الفروع تلقائيًا.</p>
        ) : branches.length === 0 ? (
          <p className="text-sm text-gray-500">لا توجد فروع متاحة لك لمنحها.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-gray-50">
                <input
                  type="checkbox"
                  name="branchIds"
                  value={b.id}
                  defaultChecked={initial?.branchIds.includes(b.id)}
                  className="size-4 rounded border-gray-300 accent-brand-700"
                />
                {b.nameAr}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {mode === "edit" && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial?.isActive}
            disabled={isSelf}
            className="size-4 rounded border-gray-300 accent-brand-700"
          />
          الحساب نشط
          {isSelf && <input type="hidden" name="isActive" value="on" />}
        </label>
      )}

      <div className="flex justify-end">
        <SubmitButton>{mode === "create" ? "إنشاء المستخدم" : "حفظ التعديلات"}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function ResetPasswordForm({ action }: { action: (prev: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionForm(action, {});
  return (
    <ActionForm onSubmit={formAction} pending={pending} className="space-y-4">
      {state.error && <Alert>{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <Field label="كلمة مرور مؤقتة جديدة" htmlFor="reset-password" hint="ستُنهى جميع جلسات المستخدم الحالية.">
        <input id="reset-password" name="password" type="password" dir="ltr" autoComplete="new-password" required minLength={10} className={inputClass} />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary" pendingText="جارٍ التعيين…">إعادة تعيين كلمة المرور</SubmitButton>
      </div>
    </ActionForm>
  );
}
