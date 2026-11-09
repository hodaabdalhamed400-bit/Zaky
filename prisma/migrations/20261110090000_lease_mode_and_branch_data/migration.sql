-- قرار معتمد: قاعات الاجتماعات تُدار بحجوزات منفصلة بالساعة/اليوم، وليس بعقود.
CREATE TYPE "LeaseMode" AS ENUM ('LEASE', 'BOOKING');
ALTER TABLE "unit_types" ADD COLUMN "lease_mode" "LeaseMode" NOT NULL DEFAULT 'LEASE';
UPDATE "unit_types" SET "lease_mode" = 'BOOKING' WHERE "key" = 'MEETING_ROOM';

-- بيانات الفروع المؤكدة من الإدارة (لا تُغيّر قيمة أدخلها المستخدم يدويًا)
UPDATE "branches" SET "city" = 'الرياض' WHERE "code" = 'MRK' AND "city" IS NULL;
UPDATE "branches" SET "notes" = 'يُعرف سابقًا باسم: القصر مول' WHERE "code" = 'SWD' AND "notes" IS NULL;
UPDATE "branches" SET "notes" = 'يُعرف سابقًا باسم: بهو الجامعة' WHERE "code" = 'IMU' AND "notes" IS NULL;
