/** صفحات الطباعة/PDF: خلفية بيضاء دائمًا حتى لا تُطبع خلفية النظام الرمادية. */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-white">
      <style>{`html, body { background: #fff !important; } @media print { html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      {children}
    </div>
  );
}
