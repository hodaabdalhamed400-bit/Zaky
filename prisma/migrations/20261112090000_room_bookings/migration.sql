-- وحدة حجوزات قاعات الاجتماعات
CREATE TYPE "BookingStatus" AS ENUM ('CONFIRMED', 'CANCELLED');
CREATE TYPE "BookingPaymentStatus" AS ENUM ('FREE', 'UNPAID', 'PAID');

CREATE TABLE "room_bookings" (
  "id" UUID NOT NULL,
  "booking_no" TEXT NOT NULL,
  "branch_id" UUID NOT NULL,
  "unit_id" UUID NOT NULL,
  "booking_date" DATE NOT NULL,
  "start_hour" INTEGER NOT NULL,
  "end_hour" INTEGER NOT NULL,
  "hours" INTEGER NOT NULL,
  "tenant_id" UUID,
  "visitor_name" TEXT,
  "visitor_mobile" TEXT,
  "free_hours" INTEGER NOT NULL DEFAULT 0,
  "paid_hours" INTEGER NOT NULL DEFAULT 0,
  "hourly_price" DECIMAL(14,2) NOT NULL,
  "charge_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "status" "BookingStatus" NOT NULL DEFAULT 'CONFIRMED',
  "payment_status" "BookingPaymentStatus" NOT NULL,
  "notes" TEXT,
  "created_by_id" UUID,
  "cancelled_by_id" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancel_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "room_bookings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "room_bookings_booking_no_key" ON "room_bookings"("booking_no");
CREATE INDEX "room_bookings_branch_id_booking_date_idx" ON "room_bookings"("branch_id", "booking_date");
CREATE INDEX "room_bookings_tenant_id_booking_date_idx" ON "room_bookings"("tenant_id", "booking_date");
CREATE INDEX "room_bookings_unit_id_booking_date_idx" ON "room_bookings"("unit_id", "booking_date");
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- قيود السلامة: ساعات كاملة ضمن 8 صباحًا – 10 مساءً، والحسابات متسقة
ALTER TABLE "room_bookings" ADD CONSTRAINT room_bookings_hours_valid CHECK (
  start_hour >= 8 AND end_hour <= 22 AND end_hour > start_hour AND hours = end_hour - start_hour
);
ALTER TABLE "room_bookings" ADD CONSTRAINT room_bookings_split_valid CHECK (
  free_hours >= 0 AND paid_hours >= 0 AND free_hours + paid_hours = hours
  AND hourly_price >= 0 AND charge_amount = paid_hours * hourly_price
);
-- إما مستأجر أو زائر خارجي (والزائر لا ساعات مجانية له)
ALTER TABLE "room_bookings" ADD CONSTRAINT room_bookings_customer CHECK (
  (tenant_id IS NOT NULL AND visitor_name IS NULL)
  OR (tenant_id IS NULL AND visitor_name IS NOT NULL AND free_hours = 0)
);
ALTER TABLE "room_bookings" ADD CONSTRAINT room_bookings_payment_status CHECK (
  (charge_amount = 0 AND payment_status = 'FREE') OR (charge_amount > 0 AND payment_status IN ('UNPAID','PAID'))
);
ALTER TABLE "room_bookings" ADD CONSTRAINT room_bookings_cancel_complete CHECK (
  status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)
);
-- منع حجزين متداخلين لنفس القاعة في نفس اليوم (حتى مع الطلبات المتزامنة)
ALTER TABLE "room_bookings" ADD CONSTRAINT room_bookings_no_overlap
  EXCLUDE USING gist (
    unit_id WITH =,
    booking_date WITH =,
    int4range(start_hour, end_hour) WITH &&
  ) WHERE (status = 'CONFIRMED');

-- ربط دفعة بحجز
ALTER TABLE "payments" ADD COLUMN "booking_id" UUID;
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "room_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");
-- الدفعة تخص عقدًا أو حجزًا، لا كليهما
ALTER TABLE "payments" ADD CONSTRAINT payments_single_purpose CHECK (NOT (contract_id IS NOT NULL AND booking_id IS NOT NULL));

-- دفعات الزوار الخارجيين لا ترتبط بعميل مسجل؛ دفعات العقود تبقى إلزامية الربط بعميل
ALTER TABLE "payments" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "payments" ADD CONSTRAINT payments_has_payer CHECK (tenant_id IS NOT NULL OR booking_id IS NOT NULL);
ALTER TABLE "payments" ADD CONSTRAINT payments_contract_has_tenant CHECK (contract_id IS NULL OR tenant_id IS NOT NULL);
