-- The foundation models cannot be converted safely: Schedule DateTime values
-- do not identify a business-local recurrence and Enrollment points to one
-- ClassSession instead of a contractual period. Refuse to guess history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Schedule" LIMIT 1) THEN
    RAISE EXCEPTION 'Scheduling migration requires an explicit mapping for existing Schedule rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "ClassSession" LIMIT 1) THEN
    RAISE EXCEPTION 'Scheduling migration requires an explicit mapping for existing ClassSession rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Enrollment" LIMIT 1) THEN
    RAISE EXCEPTION 'Scheduling migration requires an explicit mapping for existing Enrollment rows'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

BEGIN;

ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_studentId_fkey";
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_subscriptionId_fkey";
ALTER TABLE "Enrollment" DROP CONSTRAINT "Enrollment_classSessionId_fkey";

DROP INDEX "ClassSession_scheduleId_idx";
DROP INDEX "ClassSession_startTime_endTime_idx";
DROP INDEX "Enrollment_subscriptionId_idx";
DROP INDEX "Enrollment_classSessionId_idx";
DROP INDEX "Enrollment_studentId_classSessionId_key";

ALTER TABLE "Schedule"
  DROP COLUMN "capacity",
  DROP COLUMN "endTime",
  DROP COLUMN "startTime",
  ADD COLUMN "defaultCapacity" INTEGER NOT NULL,
  ADD COLUMN "endMinute" INTEGER NOT NULL,
  ADD COLUMN "startMinute" INTEGER NOT NULL;

ALTER TABLE "ClassSession"
  DROP COLUMN "endTime",
  DROP COLUMN "startTime",
  ADD COLUMN "cancellationReason" VARCHAR(500),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByAdminId" TEXT,
  ADD COLUMN "endAt" TIMESTAMP(3) NOT NULL,
  ADD COLUMN "occurrenceDate" DATE NOT NULL,
  ADD COLUMN "startAt" TIMESTAMP(3) NOT NULL;

ALTER TABLE "Enrollment"
  DROP COLUMN "classSessionId",
  DROP COLUMN "enrolledAt",
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "scheduleId" TEXT NOT NULL,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL,
  ADD COLUMN "validFrom" DATE NOT NULL,
  ADD COLUMN "validUntil" DATE NOT NULL;

ALTER TABLE "Schedule"
  ADD CONSTRAINT "Schedule_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  ADD CONSTRAINT "Schedule_startMinute_check" CHECK ("startMinute" BETWEEN 0 AND 1439),
  ADD CONSTRAINT "Schedule_endMinute_check" CHECK ("endMinute" BETWEEN 1 AND 1439),
  ADD CONSTRAINT "Schedule_time_check" CHECK ("startMinute" < "endMinute"),
  ADD CONSTRAINT "Schedule_defaultCapacity_check" CHECK ("defaultCapacity" BETWEEN 1 AND 1000);

ALTER TABLE "ClassSession"
  ADD CONSTRAINT "ClassSession_time_check" CHECK ("startAt" < "endAt"),
  ADD CONSTRAINT "ClassSession_capacity_check" CHECK ("capacity" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "ClassSession_cancellation_check" CHECK (
    (
      "status" = 'CANCELLED'
      AND "cancelledAt" IS NOT NULL
      AND "cancelledByAdminId" IS NOT NULL
      AND char_length(btrim("cancellationReason")) BETWEEN 3 AND 500
    )
    OR (
      "status" <> 'CANCELLED'
      AND "cancelledAt" IS NULL
      AND "cancelledByAdminId" IS NULL
      AND "cancellationReason" IS NULL
    )
  );

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_period_check" CHECK ("validFrom" < "validUntil");

CREATE INDEX "Schedule_dayOfWeek_startMinute_id_idx"
  ON "Schedule"("dayOfWeek", "startMinute", "id");
CREATE INDEX "ClassSession_occurrenceDate_status_idx"
  ON "ClassSession"("occurrenceDate", "status");
CREATE INDEX "ClassSession_startAt_endAt_idx"
  ON "ClassSession"("startAt", "endAt");
CREATE INDEX "ClassSession_cancelledByAdminId_idx"
  ON "ClassSession"("cancelledByAdminId");
CREATE UNIQUE INDEX "ClassSession_scheduleId_occurrenceDate_key"
  ON "ClassSession"("scheduleId", "occurrenceDate");
CREATE INDEX "Enrollment_studentId_validFrom_validUntil_idx"
  ON "Enrollment"("studentId", "validFrom", "validUntil");
CREATE INDEX "Enrollment_subscriptionId_validFrom_validUntil_idx"
  ON "Enrollment"("subscriptionId", "validFrom", "validUntil");
CREATE INDEX "Enrollment_scheduleId_validFrom_validUntil_idx"
  ON "Enrollment"("scheduleId", "validFrom", "validUntil");
CREATE UNIQUE INDEX "Subscription_id_studentId_key"
  ON "Subscription"("id", "studentId");

ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_no_schedule_overlap"
  EXCLUDE USING gist (
    "studentId" WITH =,
    "scheduleId" WITH =,
    daterange("validFrom", "validUntil", '[)') WITH &&
  );

ALTER TABLE "ClassSession"
  ADD CONSTRAINT "ClassSession_cancelledByAdminId_fkey"
  FOREIGN KEY ("cancelledByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId", "studentId") REFERENCES "Subscription"("id", "studentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Enrollment"
  ADD CONSTRAINT "Enrollment_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
