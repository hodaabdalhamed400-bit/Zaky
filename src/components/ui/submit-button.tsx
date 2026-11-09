"use client";
import { useFormStatus } from "react-dom";
import { buttonClass, type ButtonVariant } from "./primitives";

export function SubmitButton({
  children,
  pendingText = "جارٍ الحفظ…",
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  variant?: ButtonVariant;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, className)}>
      {pending && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {pending ? pendingText : children}
    </button>
  );
}
