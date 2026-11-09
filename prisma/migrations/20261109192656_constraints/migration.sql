-- ZAKI Smart ERP — قيود سلامة البيانات على مستوى قاعدة البيانات
-- هذه القيود لا يمكن التعبير عنها في Prisma schema، وهي خط الدفاع الأخير
-- حتى لو تجاوز خطأٌ ما طبقة الخدمات أو الواجهة.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ───── المستخدمون ─────
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
ALTER TABLE users ADD CONSTRAINT users_failed_login_nonneg CHECK (failed_login_count >= 0);

-- ───── الوحدات ─────
ALTER TABLE units ADD CONSTRAINT units_capacity_positive CHECK (capacity >= 1);
ALTER TABLE units ADD CONSTRAINT units_base_price_nonneg CHECK (base_price >= 0);
ALTER TABLE units ADD CONSTRAINT units_area_positive CHECK (area_sqm IS NULL OR area_sqm > 0);

-- ───── المستأجرون: منع التكرار غير المقصود ─────
CREATE UNIQUE INDEX tenants_cr_number_unique ON tenants (cr_number) WHERE cr_number IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX tenants_national_id_unique ON tenants (national_id) WHERE national_id IS NOT NULL AND archived_at IS NULL;
CREATE UNIQUE INDEX tenants_vat_number_unique ON tenants (vat_number) WHERE vat_number IS NOT NULL AND archived_at IS NULL;

-- ───── العقود ─────
ALTER TABLE contracts ADD CONSTRAINT contracts_dates_valid CHECK (end_date >= start_date);
ALTER TABLE contracts ADD CONSTRAINT contracts_amounts_nonneg CHECK (
  rent_amount >= 0 AND discount_amount >= 0 AND vat_amount >= 0
  AND total_amount >= 0 AND deposit_amount >= 0
  AND discount_amount <= rent_amount
);
ALTER TABLE contracts ADD CONSTRAINT contracts_vat_rate_range CHECK (vat_rate >= 0 AND vat_rate < 1);
ALTER TABLE contracts ADD CONSTRAINT contracts_not_self_renewal CHECK (previous_contract_id IS NULL OR previous_contract_id <> id);

ALTER TABLE contract_units ADD CONSTRAINT contract_units_dates_valid CHECK (end_date >= start_date);
ALTER TABLE contract_units ADD CONSTRAINT contract_units_seats_positive CHECK (seats >= 1);
ALTER TABLE contract_units ADD CONSTRAINT contract_units_price_nonneg CHECK (price >= 0);

-- منع تداخل فترات التأجير على نفس الوحدة الحصرية.
-- الفترة مغلقة الطرفين [start, end]؛ أي يوم مشترك يعتبر تعارضًا.
-- الوحدات المشتركة (SHARED) يحكمها مجموع المقاعد مقابل السعة داخل طبقة الخدمات مع قفل الصف.
ALTER TABLE contract_units ADD CONSTRAINT contract_units_no_overlap
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (blocks_occupancy AND occupancy_mode = 'EXCLUSIVE');

-- ───── جدول الدفعات ─────
ALTER TABLE payment_schedules ADD CONSTRAINT schedules_amounts_valid CHECK (
  net_amount >= 0 AND vat_amount >= 0
  AND amount_due = net_amount + vat_amount
  AND amount_paid >= 0
  AND amount_paid + amount_adjusted <= amount_due
);
ALTER TABLE payment_schedules ADD CONSTRAINT schedules_period_valid CHECK (period_end >= period_start);

-- ───── المدفوعات ─────
ALTER TABLE payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);
-- منع تسجيل نفس عملية الدفع مرتين (نفس الوسيلة ونفس رقم المرجع) ما لم تكن مرفوضة
CREATE UNIQUE INDEX payments_method_reference_unique
  ON payments (method, lower(btrim(reference_no)))
  WHERE reference_no IS NOT NULL AND btrim(reference_no) <> '' AND status <> 'REJECTED';
ALTER TABLE payments ADD CONSTRAINT payments_approval_consistent CHECK (
  (status IN ('APPROVED','REVERSED') AND approved_at IS NOT NULL AND receipt_no IS NOT NULL)
  OR (status IN ('PENDING_REVIEW','REJECTED') AND receipt_no IS NULL)
);

ALTER TABLE payment_allocations ADD CONSTRAINT allocations_amount_positive CHECK (amount > 0);

ALTER TABLE deposits ADD CONSTRAINT deposits_amount_positive CHECK (amount > 0);
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK (amount > 0);
ALTER TABLE adjustments ADD CONSTRAINT adjustments_amount_nonzero CHECK (amount <> 0);

-- ───── المستندات: يجب ربط المستند بكيان واحد على الأقل ─────
ALTER TABLE documents ADD CONSTRAINT documents_has_owner CHECK (
  num_nonnulls(tenant_id, contract_id, payment_id, unit_id) >= 1
);
ALTER TABLE documents ADD CONSTRAINT documents_size_positive CHECK (size_bytes > 0);

-- ───── الحماية من الحذف/التعديل للسجلات المالية المعتمدة ─────
CREATE OR REPLACE FUNCTION zaki_protect_approved_payment() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('APPROVED','REVERSED') THEN
      RAISE EXCEPTION 'ZAKI_IMMUTABLE: لا يمكن حذف دفعة معتمدة؛ استخدم قيد عكس (reversal)'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  -- UPDATE: بعد الاعتماد لا يُسمح إلا بتحويل الحالة إلى REVERSED
  IF OLD.status IN ('APPROVED','REVERSED') THEN
    IF NEW.amount <> OLD.amount OR NEW.method <> OLD.method
       OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
       OR NEW.paid_on <> OLD.paid_on OR NEW.tenant_id <> OLD.tenant_id
       OR NEW.contract_id IS DISTINCT FROM OLD.contract_id
       OR NEW.branch_id <> OLD.branch_id
       OR NEW.receipt_no IS DISTINCT FROM OLD.receipt_no
       OR NOT (NEW.status = OLD.status OR (OLD.status = 'APPROVED' AND NEW.status = 'REVERSED')) THEN
      RAISE EXCEPTION 'ZAKI_IMMUTABLE: لا يمكن تعديل بيانات دفعة معتمدة؛ استخدم قيد تصحيح'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_protect_approved
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION zaki_protect_approved_payment();

CREATE OR REPLACE FUNCTION zaki_protect_allocation() RETURNS trigger AS $$
DECLARE st "PaymentStatus";
BEGIN
  SELECT status INTO st FROM payments WHERE id = OLD.payment_id;
  IF st IN ('APPROVED','REVERSED') THEN
    RAISE EXCEPTION 'ZAKI_IMMUTABLE: لا يمكن تعديل أو حذف توزيع دفعة معتمدة'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocations_protect
  BEFORE UPDATE OR DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION zaki_protect_allocation();

-- نسخ العقود: إضافة فقط
CREATE OR REPLACE FUNCTION zaki_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ZAKI_APPEND_ONLY: الجدول % للإضافة فقط', TG_TABLE_NAME
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contract_versions_append_only
  BEFORE UPDATE OR DELETE ON contract_versions
  FOR EACH ROW EXECUTE FUNCTION zaki_append_only();

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION zaki_append_only();

-- TRUNCATE يتجاوز Triggers الصفوف؛ نمنعه أيضًا على سجل التدقيق
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION zaki_append_only();
