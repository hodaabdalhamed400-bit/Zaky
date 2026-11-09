import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <p className="text-5xl font-bold text-brand-700">404</p>
        <p className="mt-3 text-lg font-medium">الصفحة غير موجودة</p>
        <Link href="/" className="mt-4 inline-block text-brand-700 hover:underline">العودة للرئيسية</Link>
      </div>
    </div>
  );
}
