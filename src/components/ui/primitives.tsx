import Link from "next/link";
import { Icon, type IconName } from "./icons";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const BTN = {
  primary:
    "bg-gradient-to-l from-brand-700 to-brand-900 text-white shadow-md shadow-brand-900/15 hover:shadow-lg hover:shadow-brand-900/25 hover:brightness-110 disabled:from-brand-200 disabled:to-brand-200 disabled:shadow-none",
  secondary: "bg-white text-gray-800 border border-gray-300 shadow-xs hover:border-accent-500/60 hover:bg-accent-50/40 hover:text-brand-900 disabled:text-gray-400",
  danger: "bg-gradient-to-l from-red-600 to-red-700 text-white shadow-md shadow-red-900/15 hover:brightness-110 disabled:from-red-300 disabled:to-red-300",
  ghost: "text-gray-700 hover:bg-brand-50 hover:text-brand-900",
};
export type ButtonVariant = keyof typeof BTN;
export const buttonClass = (v: ButtonVariant = "primary", extra?: string) =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100",
    BTN[v],
    extra,
  );

export function LinkButton({
  href,
  children,
  variant = "primary",
  icon,
}: {
  href: string;
  children: React.ReactNode;
  variant?: ButtonVariant;
  icon?: IconName;
}) {
  return (
    <Link href={href} className={buttonClass(variant)}>
      {icon && <Icon name={icon} className="size-4" />}
      {children}
    </Link>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cx("animate-fade-up rounded-2xl border border-gray-200/80 bg-white shadow-[0_1px_2px_rgb(16_24_40/0.04),0_4px_16px_-6px_rgb(19_46_75/0.08)] transition-shadow duration-300 hover:shadow-[0_2px_4px_rgb(16_24_40/0.05),0_12px_28px_-10px_rgb(19_46_75/0.16)]", className)}>{children}</section>;
}

export function CardHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
        <span className="h-4 w-1 rounded-full bg-gradient-to-b from-accent-500 to-brand-700" aria-hidden="true" />
        {title}
      </h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="animate-fade-up mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-brand-900 sm:text-[1.7rem]">{title}</h1>
        <div className="mt-2 h-1 w-14 origin-right animate-grow-x rounded-full bg-gradient-to-l from-accent-500 to-brand-700" aria-hidden="true" />
        {description && <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BADGE = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  brand: "bg-accent-50 text-accent-700 ring-accent-600/20",
};
export function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: keyof typeof BADGE }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-gray-500/10", BADGE[color])}>
      <span className="size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info" | "warning"; children: React.ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[kind];
  const icon: IconName = kind === "success" ? "check" : "alert";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cx("animate-scale-in flex items-start gap-2 rounded-xl border px-4 py-3 text-sm", styles)}>
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon = "inbox" }: { title: string; description?: string; action?: React.ReactNode; icon?: IconName }) {
  return (
    <div className="animate-fade-in flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 rounded-2xl bg-accent-500/20 blur-xl" aria-hidden="true" />
        <div className="relative animate-float rounded-2xl bg-gradient-to-br from-accent-50 to-brand-50 p-3.5 text-brand-700 ring-1 ring-brand-100">
          <Icon name={icon} className="size-6" />
        </div>
      </div>
      <p className="font-medium text-gray-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-accent-50/50">{children}</table>
    </div>
  );
}
export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={cx("bg-gray-50/80 px-4 py-3 text-start text-xs font-semibold text-brand-700/80", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cx("border-t border-gray-100 px-4 py-3 align-middle text-gray-800", className)}>{children}</td>;
}

export const inputClass =
  "block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs transition-[border-color,box-shadow] duration-200 placeholder:text-gray-400 hover:border-gray-400 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/15 disabled:bg-gray-100";

export function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ms-0.5 text-red-600" aria-hidden="true">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
