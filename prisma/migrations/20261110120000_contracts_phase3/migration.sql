-- المرحلة 3: العقود
CREATE TYPE "EarlyExitPolicy" AS ENUM ('KEEP_DUE', 'CANCEL_FUTURE');

ALTER TABLE "contracts"
  ADD COLUMN "duration_months" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "early_exit_policy" "EarlyExitPolicy",
  ADD COLUMN "rejection_reason" TEXT;
ALTER TABLE "contracts" ALTER COLUMN "duration_months" DROP DEFAULT;
ALTER TABLE "contracts" ADD CONSTRAINT contracts_duration_range CHECK (duration_months BETWEEN 1 AND 120);
-- الإجمالي = الإيجار − الخصم (كل المبالغ شاملة الضريبة)
ALTER TABLE "contracts" ADD CONSTRAINT contracts_total_consistent CHECK (total_amount = rent_amount - discount_amount);
-- الإنهاء المبكر يتطلب سياسة وتاريخًا وسببًا
ALTER TABLE "contracts" ADD CONSTRAINT contracts_termination_complete CHECK (
  status <> 'TERMINATED' OR (ended_at IS NOT NULL AND end_reason IS NOT NULL AND early_exit_policy IS NOT NULL)
);

CREATE INDEX "tenants_email_idx" ON "tenants" (lower("email"));
