"use client";

export default function ErrorPage({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
      <div>
        <p className="text-lg font-semibold">حدث خطأ غير متوقع</p>
        <p className="mt-1 text-sm text-gray-500">تم تسجيل الخطأ. حاول مرة أخرى، وإذا تكرر تواصل مع مسؤول النظام.</p>
        {error.digest && <p dir="ltr" className="mt-2 text-xs text-gray-400">ref: {error.digest}</p>}
        <button onClick={reset} className="mt-4 rounded-lg bg-brand-700 px-4 py-2 text-sm text-white">إعادة المحاولة</button>
      </div>
    </div>
  );
}
