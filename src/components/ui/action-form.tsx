"use client";
import { createContext, startTransition, useActionState, useContext } from "react";

/**
 * React 19 يمسح حقول النموذج تلقائيًا بعد كل إرسال لنموذج مربوط بإجراء خادم (action)،
 * حتى عند فشل التحقق — فيضطر المستخدم لإعادة كتابة كل شيء.
 * هذا الغلاف يرسل عبر onSubmit + startTransition فتبقى المدخلات كما هي عند الخطأ،
 * ويوفر حالة "جارٍ الحفظ" لأزرار الإرسال عبر السياق (يمنع الإرسال المزدوج).
 */
export const FormPendingContext = createContext<boolean | null>(null);

export function useFormPending(): boolean | null {
  return useContext(FormPendingContext);
}

export function useActionForm<S>(action: (prev: S, fd: FormData) => Promise<S>, initial: S) {
  const [state, dispatch, pending] = useActionState(action as (prev: Awaited<S>, fd: FormData) => Promise<S>, initial as Awaited<S>);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const fd = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? new FormData(e.currentTarget, submitter) : new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  return [state, onSubmit, pending] as const;
}

type Props = Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit" | "action"> & {
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  pending: boolean;
  ref?: React.Ref<HTMLFormElement>;
};

export function ActionForm({ onSubmit, pending, children, ...rest }: Props) {
  return (
    <FormPendingContext.Provider value={pending}>
      <form onSubmit={onSubmit} aria-busy={pending} {...rest}>
        {children}
      </form>
    </FormPendingContext.Provider>
  );
}
