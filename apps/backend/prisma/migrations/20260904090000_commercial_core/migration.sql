-- Subscription and Payment existed only as planned foundation models. Their
-- previous rows do not contain a trustworthy contract snapshot or payment
-- author. Refuse to invent history; an operator must map those rows explicitly.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Subscription" LIMIT 1) THEN
    RAISE EXCEPTION 'Commercial migration requires an explicit mapping for existing Subscription rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Payment" LIMIT 1) THEN
    RAISE EXCEPTION 'Commercial migration requires an explicit mapping for existing Payment rows'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'TRANSFER', 'OTHER');
CREATE TYPE "PaymentStatus_new" AS ENUM ('CONFIRMED', 'VOIDED');

ALTER TABLE "Payment" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Payment"
  ALTER COLUMN "status" TYPE "PaymentStatus_new"
  USING (
    CASE "status"::text
      WHEN 'COMPLETED' THEN 'CONFIRMED'::"PaymentStatus_new"
      ELSE 'VOIDED'::"PaymentStatus_new"
    END
  );
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "PaymentStatus_old";

ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_studentId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_subscriptionId_fkey";
DROP INDEX "Subscription_studentId_periodStart_periodEnd_idx";
DROP INDEX "Payment_subscriptionId_idx";

ALTER TABLE "Plan"
  ADD COLUMN "currency" VARCHAR(3) NOT NULL DEFAULT 'ARS',
  ALTER COLUMN "name" SET DATA TYPE VARCHAR(120),
  ALTER COLUMN "description" SET DATA TYPE VARCHAR(500),
  ALTER COLUMN "classCount" DROP DEFAULT;

ALTER TABLE "Subscription"
  DROP COLUMN "isActive",
  ADD COLUMN "agreedPrice" DECIMAL(10,2) NOT NULL,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "classAllowance" INTEGER NOT NULL,
  ADD COLUMN "currency" VARCHAR(3) NOT NULL,
  ADD COLUMN "planName" VARCHAR(120) NOT NULL,
  ADD COLUMN "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "Payment"
  ADD COLUMN "createdByAdminId" TEXT NOT NULL,
  ADD COLUMN "idempotencyKey" VARCHAR(64) NOT NULL,
  ADD COLUMN "method" "PaymentMethod",
  ADD COLUMN "note" VARCHAR(500),
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedByAdminId" TEXT,
  ADD COLUMN "voidReason" VARCHAR(500),
  ALTER COLUMN "currency" DROP DEFAULT,
  ALTER COLUMN "currency" SET DATA TYPE VARCHAR(3),
  ALTER COLUMN "status" SET DEFAULT 'CONFIRMED',
  ALTER COLUMN "paidAt" SET NOT NULL;

ALTER TABLE "Plan"
  ADD CONSTRAINT "Plan_name_check" CHECK (char_length(btrim("name")) BETWEEN 2 AND 120),
  ADD CONSTRAINT "Plan_classCount_check" CHECK ("classCount" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "Plan_price_check" CHECK ("price" >= 0),
  ADD CONSTRAINT "Plan_currency_check" CHECK ("currency" = 'ARS');

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_planName_check" CHECK (char_length(btrim("planName")) BETWEEN 2 AND 120),
  ADD CONSTRAINT "Subscription_classAllowance_check" CHECK ("classAllowance" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "Subscription_agreedPrice_check" CHECK ("agreedPrice" >= 0),
  ADD CONSTRAINT "Subscription_currency_check" CHECK ("currency" = 'ARS'),
  ADD CONSTRAINT "Subscription_period_check" CHECK ("periodStart" < "periodEnd"),
  ADD CONSTRAINT "Subscription_cancellation_check" CHECK (
    ("status" = 'ACTIVE' AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL)
  );

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_check" CHECK ("amount" > 0),
  ADD CONSTRAINT "Payment_currency_check" CHECK ("currency" = 'ARS'),
  ADD CONSTRAINT "Payment_void_check" CHECK (
    ("status" = 'CONFIRMED' AND "voidedAt" IS NULL AND "voidedByAdminId" IS NULL AND "voidReason" IS NULL)
    OR ("status" = 'VOIDED' AND "voidedAt" IS NOT NULL AND "voidedByAdminId" IS NOT NULL AND char_length(btrim("voidReason")) BETWEEN 3 AND 500)
  );

CREATE INDEX "Subscription_studentId_status_periodStart_periodEnd_idx"
  ON "Subscription"("studentId", "status", "periodStart", "periodEnd");
CREATE INDEX "Payment_subscriptionId_status_paidAt_idx"
  ON "Payment"("subscriptionId", "status", "paidAt");
CREATE INDEX "Payment_createdByAdminId_idx" ON "Payment"("createdByAdminId");
CREATE INDEX "Payment_voidedByAdminId_idx" ON "Payment"("voidedByAdminId");
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_no_active_overlap"
  EXCLUDE USING gist (
    "studentId" WITH =,
    tsrange("periodStart", "periodEnd", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_createdByAdminId_fkey"
  FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_voidedByAdminId_fkey"
  FOREIGN KEY ("voidedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
