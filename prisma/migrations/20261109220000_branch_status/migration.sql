-- حالة الفرع: عامل / قيد التجهيز / موقوف (بدل is_active) + تكليف المدير المؤقت
CREATE TYPE "BranchStatus" AS ENUM ('ACTIVE', 'PREPARING', 'INACTIVE');

ALTER TABLE "branches"
  ADD COLUMN "status" "BranchStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "manager_acting" BOOLEAN NOT NULL DEFAULT false;

-- نقل البيانات الحالية قبل حذف العمود القديم (لا فقد للبيانات)
UPDATE "branches" SET "status" = 'INACTIVE' WHERE "is_active" = false;

ALTER TABLE "branches" DROP COLUMN "is_active";

CREATE INDEX "branches_status_idx" ON "branches" ("status");
