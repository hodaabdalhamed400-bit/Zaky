import { IBM_Plex_Sans_Arabic } from "next/font/google";

/**
 * خط صفحات الطباعة/PDF: IBM Plex Sans Arabic (ملفات خط ثابتة). خط Cairo المتغير الذي تستخدمه
 * الواجهة يُضمَّن في PDF كـ Type 3 فيتكسّر النص عند النسخ والبحث (مثل «الر يادة»)،
 * لذلك تبقى العقود والإيصالات والتقارير المطبوعة على خط يُضمَّن كنص قابل للبحث.
 */
const printFont = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** صفحات الطباعة/PDF: خلفية بيضاء دائمًا حتى لا تُطبع خلفية النظام الرمادية. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${printFont.className} min-h-dvh bg-white`}>
      <style>{`html, body { background: #fff !important; } @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      {children}
    </div>
  );
}
