-- المرحلة 4: التحصيل
ALTER TABLE "payments"
  ADD COLUMN "rejected_by_id" UUID,
  ADD COLUMN "rejected_at" TIMESTAMPTZ(3),
  ADD COLUMN "reversed_by_id" UUID,
  ADD COLUMN "reversed_at" TIMESTAMPTZ(3),
  ADD COLUMN "reversal_reason" TEXT;

ALTER TABLE "payments" ADD CONSTRAINT payments_reversal_complete CHECK (
  status <> 'REVERSED' OR (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL)
);
ALTER TABLE "payments" ADD CONSTRAINT payments_rejection_complete CHECK (
  status <> 'REJECTED' OR (rejected_at IS NOT NULL AND rejected_reason IS NOT NULL)
);

-- قرار معتمد: لا توجد رسوم تأخير، والتسويات تخفض المستحق فقط
ALTER TABLE "adjustments" ADD CONSTRAINT adjustments_no_late_fee CHECK (type <> 'LATE_FEE');
ALTER TABLE "adjustments" ADD CONSTRAINT adjustments_reduce_only CHECK (amount > 0);
-- التسويات المعتمدة لا تُعدّل ولا تُحذف
CREATE TRIGGER adjustments_append_only
  BEFORE UPDATE OR DELETE ON adjustments
  FOR EACH ROW EXECUTE FUNCTION zaki_append_only();

-- قرار معتمد: لا دفع زائد — مجموع توزيعات الدفعة لا يتجاوز مبلغها
-- (التساوي التام تفرضه طبقة الخدمات داخل نفس المعاملة)
CREATE OR REPLACE FUNCTION zaki_allocation_within_payment() RETURNS trigger AS $$
DECLARE total numeric; amt numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO total FROM payment_allocations WHERE payment_id = NEW.payment_id;
  SELECT amount INTO amt FROM payments WHERE id = NEW.payment_id;
  IF total > amt THEN
    RAISE EXCEPTION 'ZAKI_OVERPAYMENT: مجموع التوزيع يتجاوز مبلغ الدفعة' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER payment_allocations_within_payment
  AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION zaki_allocation_within_payment();
