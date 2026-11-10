/** يُعاد تركيبه مع كل تنقّل، فتظهر كل صفحة بحركة دخول ناعمة */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
