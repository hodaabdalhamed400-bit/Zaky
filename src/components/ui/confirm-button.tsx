"use client";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "./primitives";

/** زر إرسال يطلب تأكيدًا قبل تنفيذ إجراء حساس (أرشفة، حذف، إيقاف). */
export function ConfirmButton({
  children,
  message,
  variant = "secondary",
  className,
}: {
  children: React.ReactNode;
  message: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={buttonClass(variant, className)}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {pending ? "جارٍ التنفيذ…" : children}
    </button>
  );
}
