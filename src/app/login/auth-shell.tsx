import { AuthBackdrop } from "./auth-backdrop";

/**
 * إطار صفحات الدخول: خلفية كحلية حيّة (هالات، شبكة، جسيمات صاعدة، حلقات دوّارة)
 * وفي المنتصف بطاقة دخول بإطار مضيء يدور حولها.
 * كل الحركات CSS (عدا تتبع المؤشر)، وتتوقف مع «تقليل الحركة».
 */
const PARTICLES = [
  { l: 6, s: 4, d: 14, w: 0 }, { l: 14, s: 3, d: 18, w: 4 }, { l: 22, s: 5, d: 16, w: 9 }, { l: 31, s: 3, d: 20, w: 2 },
  { l: 39, s: 4, d: 15, w: 7 }, { l: 47, s: 2, d: 22, w: 11 }, { l: 55, s: 4, d: 17, w: 5 }, { l: 63, s: 3, d: 19, w: 1 },
  { l: 71, s: 5, d: 14, w: 8 }, { l: 79, s: 3, d: 21, w: 3 }, { l: 87, s: 4, d: 16, w: 10 }, { l: 94, s: 2, d: 18, w: 6 },
];

export function AuthShell({
  title,
  subtitle,
  greeting,
  children,
}: {
  title: string;
  subtitle: string;
  greeting?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-brand-900 via-[#0f2a47] to-[#081828] px-4 py-10">
      {/* الطبقات الخلفية */}
      <div className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]" aria-hidden="true" />
      <div className="-z-10"><AuthBackdrop /></div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[44rem] -translate-x-1/2 -translate-y-1/2" aria-hidden="true">
        <div className="absolute inset-0 animate-spin-slow rounded-full border border-dashed border-white/[0.07]" />
        <div className="absolute inset-20 animate-spin-slow rounded-full border border-accent-500/15 [animation-direction:reverse] [animation-duration:30s]">
          <span className="absolute -top-1 start-1/2 size-2 rounded-full bg-accent-500 shadow-[0_0_16px_var(--color-accent-500)]" />
        </div>
        <div className="absolute inset-40 animate-spin-slow rounded-full border border-white/[0.05] [animation-duration:55s]">
          <span className="absolute -bottom-1 start-1/3 size-1.5 rounded-full bg-white/60 shadow-[0_0_10px_white]" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        {PARTICLES.map((p, i) => (
          <span
            key={i}
            className="auth-particle"
            style={{ left: `${p.l}%`, width: p.s, height: p.s, animationDuration: `${p.d}s`, animationDelay: `-${p.w}s`, opacity: 0.7 }}
          />
        ))}
      </div>

      {/* البطاقة */}
      <main className="relative w-full max-w-[420px]">
        <div className="animate-scale-in relative rounded-[1.75rem] p-px shadow-[0_30px_80px_-20px_rgb(0_0_0/0.55)]">
          {/* إطار مضيء يدور حول البطاقة */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.75rem]" aria-hidden="true">
            <div className="absolute -inset-[60%] animate-spin bg-[conic-gradient(from_0deg,transparent_0deg,transparent_250deg,var(--color-accent-500)_310deg,white_335deg,transparent_360deg)] [animation-duration:6s]" />
            <div className="absolute inset-0 rounded-[1.75rem] ring-1 ring-white/15" />
          </div>

          <div className="relative overflow-hidden rounded-[calc(1.75rem-1px)] bg-white px-7 pb-7 pt-8 sm:px-9">
            <div className="pointer-events-none absolute -top-24 start-1/2 size-56 -translate-x-1/2 rounded-full bg-accent-500/10 blur-3xl" aria-hidden="true" />

            <div className="relative text-center">
              <div className="animate-fade-up mx-auto mb-6 w-fit [animation-delay:120ms]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/zaki-logo.svg" alt="ذكي لحاضنات ومسرعات الأعمال" width={240} height={92} className="h-16 w-auto animate-float [animation-duration:7s]" />
              </div>
              {greeting && (
                <p className="animate-fade-up mb-1 text-sm font-medium text-accent-700 [animation-delay:200ms]">
                  {greeting} <span className="inline-block origin-[70%_80%] animate-[wave_2.4s_ease-in-out_1s_3]" aria-hidden="true">👋</span>
                </p>
              )}
              <h1 className="animate-fade-up text-[1.65rem] font-bold tracking-tight text-brand-900 [animation-delay:240ms]">{title}</h1>
              <div className="mx-auto mt-2.5 h-1 w-12 origin-center animate-grow-x rounded-full bg-gradient-to-l from-accent-500 to-brand-700 [animation-delay:420ms]" aria-hidden="true" />
              <p className="animate-fade-up mt-3 text-sm leading-relaxed text-gray-500 [animation-delay:300ms]">{subtitle}</p>
            </div>

            <div className="relative mt-7">{children}</div>
          </div>
        </div>

        <div className="animate-fade-in mt-6 flex flex-col items-center gap-2 text-center [animation-delay:800ms]">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-xs text-brand-100 ring-1 ring-white/10 backdrop-blur">
            <span className="relative flex size-2">
              <span className="absolute inset-0 animate-ping-soft rounded-full bg-emerald-400" />
              <span className="relative size-2 rounded-full bg-emerald-400" />
            </span>
            اتصال آمن ومشفّر
          </span>
          <p className="max-w-sm text-xs leading-relaxed text-brand-100/60">
            نظام داخلي لشركة ذكي لحاضنات ومسرعات الأعمال. الدخول مقتصر على الموظفين المصرح لهم، وتُسجَّل جميع العمليات.
          </p>
        </div>
      </main>
    </div>
  );
}
