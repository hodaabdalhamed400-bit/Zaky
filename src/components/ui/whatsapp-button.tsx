const reminderHref = (contractId: string) => `/api/reminders/whatsapp/${contractId}`;
import { Icon } from "./icons";
import { cx } from "./primitives";

/**
 * زر «تذكير واتساب»: يفتح واتساب في نافذة جديدة برسالة جاهزة، والموظف يضغط إرسال بنفسه.
 * الرابط يمر بالخادم أولًا لتسجيل التذكير في سجل التدقيق.
 */
export function WhatsAppButton({ contractId, size = "sm", label = "تذكير واتساب" }: { contractId: string; size?: "sm" | "md"; label?: string }) {
  return (
    <a
      href={reminderHref(contractId)}
      target="_blank"
      rel="noopener noreferrer"
      title="يفتح واتساب برسالة تذكير جاهزة — اضغط إرسال من جهازك"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-l from-emerald-500 to-emerald-600 font-medium text-white shadow-sm shadow-emerald-700/20 transition-all duration-200 hover:brightness-110 active:scale-[0.97]",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm",
      )}
    >
      <Icon name="message" className={size === "sm" ? "size-3.5" : "size-4"} />
      {label}
    </a>
  );
}
