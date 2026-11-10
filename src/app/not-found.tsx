import Link from "next/link";

export default function NotFound() {
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden p-6 text-center">
      <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_65%)]" aria-hidden="true" />
      <div className="relative animate-fade-up">
        <p className="animate-float bg-gradient-to-b from-brand-700 to-accent-500 bg-clip-text text-8xl font-bold text-transparent">404</p>
        <p className="mt-4 text-lg font-semibold text-brand-900">الصفحة غير موجودة</p>
        <p className="mt-1 text-sm text-gray-500">قد يكون الرابط غير صحيح أو لا تملك صلاحية الوصول إليه.</p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center rounded-lg bg-gradient-to-l from-brand-700 to-brand-900 px-5 py-2.5 text-sm font-medium text-white shadow-md transition-all hover:brightness-110 active:scale-[0.97]"
        >
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}
