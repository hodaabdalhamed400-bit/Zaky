"use client";
export function PrintButton() {
  return <button onClick={() => window.print()} className="rounded-lg bg-brand-900 px-4 py-2 text-sm text-white">طباعة / حفظ PDF</button>;
}
