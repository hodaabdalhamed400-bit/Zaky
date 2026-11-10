import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-arabic",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "ZAKI Smart ERP", template: "%s | ZAKI Smart ERP" },
  description: "نظام إدارة الفروع والمكاتب والمستأجرين والعقود والتحصيل — شركة ذكي",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#132e4b" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // قراءة الترويسات تجعل كل الصفحات ديناميكية، فيحصل كل طلب على nonce جديد لسياسة CSP
  await headers();
  return (
    <html lang="ar" dir="rtl" className={arabic.variable}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
