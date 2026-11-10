/**
 * إطار صفحات الدخول: لوحة هوية متحركة بجانب النموذج.
 * كل الحركات CSS فقط، وتتوقف مع «تقليل الحركة».
 */
const FEATURES = [
  { t: "الفروع والوحدات", d: "إشغال لحظي لكل فرع ومكتب" },
  { t: "العقود والتحصيل", d: "أقساط وإيصالات بتسلسل كل فرع" },
  { t: "حجوزات القاعات", d: "ساعات مجانية ومدفوعة تلقائيًا" },
  { t: "صلاحيات دقيقة", d: "كل عملية مسجّلة في سجل التدقيق" },
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative flex items-center justify-center overflow-hidden px-4 py-12 sm:px-8">
        <div className="bg-dots pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-28 -end-24 size-80 animate-drift rounded-full bg-accent-500/15 blur-3xl lg:hidden" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-32 -start-24 size-80 animate-drift-slow rounded-full bg-brand-500/15 blur-3xl lg:hidden" aria-hidden="true" />
        <div className="relative w-full max-w-sm">
          <div className="animate-fade-up mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={240} height={92} className="mb-9 h-20 w-auto" />
            <h1 className="text-[1.75rem] font-bold tracking-tight text-brand-900">{title}</h1>
            <div className="mt-2 h-1 w-14 origin-right animate-grow-x rounded-full bg-gradient-to-l from-accent-500 to-brand-700 [animation-delay:200ms]" aria-hidden="true" />
            <p className="mt-3 text-sm leading-relaxed text-gray-500">{subtitle}</p>
          </div>
          <div className="animate-fade-up rounded-2xl border border-gray-200/80 bg-white/90 p-6 shadow-[0_20px_50px_-20px_rgb(19_46_75/0.25)] backdrop-blur [animation-delay:120ms]">
            {children}
          </div>
          <p className="animate-fade-in mt-8 text-xs leading-relaxed text-gray-400 [animation-delay:400ms]">
            هذا نظام داخلي لشركة ذكي لحاضنات ومسرعات الأعمال. الدخول مقتصر على الموظفين المصرح لهم، وتُسجَّل جميع العمليات.
          </p>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-900 via-[#0f2a47] to-[#0a1d31] lg:block" aria-hidden="true">
        <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_30%_30%,black,transparent_75%)]" />
        <div className="absolute -top-32 -start-24 size-[28rem] animate-drift rounded-full bg-accent-500/30 blur-3xl" />
        <div className="absolute -bottom-40 end-0 size-[30rem] animate-drift-slow rounded-full bg-[#2a78d6]/25 blur-3xl" />

        {/* الشعار داخل حلقات دوّارة */}
        <div className="absolute end-[12%] top-[14%] grid size-72 place-items-center">
          <div className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-white/15" />
          <div className="absolute inset-8 animate-spin-slow rounded-full border border-accent-500/30 [animation-direction:reverse] [animation-duration:28s]">
            <span className="absolute -top-1 start-1/2 size-2 rounded-full bg-accent-500 shadow-[0_0_14px_var(--color-accent-500)]" />
          </div>
          <div className="absolute inset-16 rounded-full bg-white/[0.04] ring-1 ring-white/10 backdrop-blur-sm" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/zaki-mark-white.svg" alt="" className="relative h-24 w-auto animate-float drop-shadow-[0_10px_30px_rgb(30_173_192/0.45)]" />
        </div>

        <div className="relative flex h-full flex-col justify-end p-12 text-white xl:p-16">
          <p className="animate-fade-up text-4xl font-bold leading-snug [animation-delay:150ms]">
            إدارة مركزية
            <br />
            <span className="bg-gradient-to-l from-accent-300 to-white bg-clip-text text-transparent">لجميع فروع ذكي</span>
          </p>
          <div className="mt-5 h-1 w-16 origin-right animate-grow-x rounded-full bg-accent-500 [animation-delay:350ms]" />
          <ul className="stagger mt-8 grid max-w-xl grid-cols-2 gap-3">
            {FEATURES.map((f) => (
              <li key={f.t} className="rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 backdrop-blur-sm transition-colors duration-300 hover:bg-white/10">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="size-1.5 rounded-full bg-accent-500 shadow-[0_0_10px_var(--color-accent-500)]" />
                  {f.t}
                </p>
                <p className="mt-1 text-xs text-brand-100/70">{f.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
