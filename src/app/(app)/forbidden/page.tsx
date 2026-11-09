import { EmptyState, LinkButton, Card } from "@/components/ui/primitives";

export default function Forbidden() {
  return (
    <Card className="mt-10">
      <EmptyState
        icon="shield"
        title="ليست لديك صلاحية للوصول إلى هذه الصفحة"
        description="إذا كنت تحتاج هذه الصلاحية، تواصل مع مسؤول النظام."
        action={<LinkButton href="/" variant="secondary">العودة للرئيسية</LinkButton>}
      />
    </Card>
  );
}
