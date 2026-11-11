-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PurchasePaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- AlterEnum
ALTER TYPE "DocumentCategory" ADD VALUE 'PURCHASE_INVOICE';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PURCHASE_PENDING_REVIEW';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "purchase_invoice_id" UUID;

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "name_ar" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoices" (
    "id" UUID NOT NULL,
    "ref_no" TEXT NOT NULL,
    "branch_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "supplier_name" TEXT NOT NULL,
    "supplier_vat_no" TEXT,
    "invoice_no" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "vat_amount" DECIMAL(14,2) NOT NULL,
    "net_amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "payment_status" "PurchasePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "payment_method" "PaymentMethod",
    "paid_on" DATE,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_name_ar_key" ON "expense_categories"("name_ar");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoices_ref_no_key" ON "purchase_invoices"("ref_no");

-- CreateIndex
CREATE INDEX "purchase_invoices_branch_id_invoice_date_idx" ON "purchase_invoices"("branch_id", "invoice_date");

-- CreateIndex
CREATE INDEX "purchase_invoices_status_idx" ON "purchase_invoices"("status");

-- CreateIndex
CREATE INDEX "documents_purchase_invoice_id_idx" ON "documents"("purchase_invoice_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ───── قيود فواتير الشراء ─────
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_amounts_valid CHECK (
  total_amount > 0 AND vat_amount >= 0 AND vat_amount <= total_amount AND net_amount = total_amount - vat_amount
);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_text_not_blank CHECK (
  length(btrim(supplier_name)) > 0 AND length(btrim(invoice_no)) > 0
);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_vat_no_format CHECK (
  supplier_vat_no IS NULL OR supplier_vat_no ~ '^3[0-9]{13}3$'
);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_approval_complete CHECK (
  status <> 'APPROVED' OR (approved_by_id IS NOT NULL AND approved_at IS NOT NULL)
);
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_rejection_complete CHECK (
  (status = 'REJECTED') = (rejection_reason IS NOT NULL AND rejected_by_id IS NOT NULL AND rejected_at IS NOT NULL)
);
-- الدفع للمورد يُسجَّل فقط بعد الاعتماد، ومعه الوسيلة والتاريخ
ALTER TABLE purchase_invoices ADD CONSTRAINT purchase_payment_complete CHECK (
  (payment_status = 'PAID' AND paid_on IS NOT NULL AND payment_method IS NOT NULL AND status = 'APPROVED')
  OR (payment_status = 'UNPAID' AND paid_on IS NULL AND payment_method IS NULL)
);
-- منع تسجيل نفس فاتورة المورد مرتين (المرفوضة لا تُحتسب)
CREATE UNIQUE INDEX purchase_invoices_no_duplicate
  ON purchase_invoices (lower(btrim(supplier_name)), lower(btrim(invoice_no)))
  WHERE status <> 'REJECTED';

-- الفاتورة المعتمدة لا تُعدَّل ولا تُحذف؛ يُسمح فقط بتحديث حالة الدفع
CREATE OR REPLACE FUNCTION zaki_purchase_approved_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'APPROVED' THEN
      RAISE EXCEPTION 'ZAKI_IMMUTABLE: لا يمكن حذف فاتورة شراء معتمدة' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'APPROVED' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.ref_no IS DISTINCT FROM OLD.ref_no
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
    OR NEW.category_id IS DISTINCT FROM OLD.category_id
    OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
    OR NEW.supplier_vat_no IS DISTINCT FROM OLD.supplier_vat_no
    OR NEW.invoice_no IS DISTINCT FROM OLD.invoice_no
    OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date
    OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
    OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount
    OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
    OR NEW.approved_by_id IS DISTINCT FROM OLD.approved_by_id
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'ZAKI_IMMUTABLE: فاتورة الشراء المعتمدة لا تُعدَّل' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER purchase_invoices_approved_immutable
  BEFORE UPDATE OR DELETE ON purchase_invoices
  FOR EACH ROW EXECUTE FUNCTION zaki_purchase_approved_immutable();

-- المستند قد يتبع فاتورة شراء
ALTER TABLE documents DROP CONSTRAINT documents_has_owner;
ALTER TABLE documents ADD CONSTRAINT documents_has_owner CHECK (
  num_nonnulls(tenant_id, contract_id, payment_id, unit_id, purchase_invoice_id) >= 1
);
