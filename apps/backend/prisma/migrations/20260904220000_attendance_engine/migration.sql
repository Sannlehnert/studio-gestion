-- Attendance from the provisional schema cannot identify the Subscription that
-- consumed a class or whether the row came from a Student or an automatic close.
-- Refuse to invent that history. Recovery also depends on those rows.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Attendance" LIMIT 1) THEN
    RAISE EXCEPTION 'Attendance migration requires an explicit mapping for existing Attendance rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "Recovery" LIMIT 1) THEN
    RAISE EXCEPTION 'Attendance migration requires an explicit mapping for existing Recovery rows'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ClassSession" WHERE "status" = 'COMPLETED' LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Attendance migration cannot infer closure time for completed ClassSession rows'
      USING ERRCODE = 'check_violation';
  END IF;
END $$;

BEGIN;

ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_studentId_fkey";
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_classSessionId_fkey";
ALTER TABLE "Recovery" DROP CONSTRAINT "Recovery_studentId_fkey";
ALTER TABLE "Recovery" DROP CONSTRAINT "Recovery_subscriptionId_fkey";

DROP INDEX "Attendance_classSessionId_idx";

ALTER TABLE "ClassSession"
  ADD COLUMN "attendanceClosedAt" TIMESTAMP(3);

ALTER TYPE "AttendanceStatus" RENAME TO "AttendanceStatus_old";
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT');
ALTER TABLE "Attendance" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Attendance"
  ALTER COLUMN "status" TYPE "AttendanceStatus"
  USING ("status"::text::"AttendanceStatus");
ALTER TABLE "Attendance"
  ALTER COLUMN "status" SET DEFAULT 'PRESENT'::"AttendanceStatus";
DROP TYPE "AttendanceStatus_old";

CREATE TYPE "AttendanceSource" AS ENUM ('STUDENT', 'SYSTEM');

ALTER TABLE "Attendance"
  DROP COLUMN "markedAt",
  DROP COLUMN "note",
  ADD COLUMN "subscriptionId" TEXT NOT NULL,
  ADD COLUMN "source" "AttendanceSource" NOT NULL,
  ADD COLUMN "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ClassSession"
  ADD CONSTRAINT "ClassSession_attendance_closure_check" CHECK (
    ("status" = 'COMPLETED' AND "attendanceClosedAt" IS NOT NULL)
    OR ("status" <> 'COMPLETED' AND "attendanceClosedAt" IS NULL)
  );

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_source_status_check" CHECK (
    ("status" = 'PRESENT' AND "source" = 'STUDENT')
    OR ("status" = 'ABSENT' AND "source" = 'SYSTEM')
  );

CREATE INDEX "ClassSession_status_endAt_attendanceClosedAt_idx"
  ON "ClassSession"("status", "endAt", "attendanceClosedAt");
CREATE INDEX "Attendance_classSessionId_status_idx"
  ON "Attendance"("classSessionId", "status");
CREATE INDEX "Attendance_subscriptionId_status_idx"
  ON "Attendance"("subscriptionId", "status");

ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_subscriptionId_studentId_fkey"
  FOREIGN KEY ("subscriptionId", "studentId") REFERENCES "Subscription"("id", "studentId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance"
  ADD CONSTRAINT "Attendance_classSessionId_fkey"
  FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recovery"
  ADD CONSTRAINT "Recovery_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Recovery"
  ADD CONSTRAINT "Recovery_subscriptionId_studentId_fkey"
  FOREIGN KEY ("subscriptionId", "studentId") REFERENCES "Subscription"("id", "studentId") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
