BEGIN;
-- Fail before DDL when historical attribution has no deterministic evidence.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "AuditLog" WHERE (CASE
 WHEN "actorId" IS NOT NULL AND "action" IN ('ADMIN_LOGIN','STUDENT_ACCESS_CREATED','STUDENT_ACCESS_REVOKED','STUDENT_CREATED','STUDENT_UPDATED','STUDENT_DEACTIVATED','STUDENT_REACTIVATED','PLAN_CREATED','PLAN_UPDATED','PLAN_ACTIVATED','PLAN_DEACTIVATED','SUBSCRIPTION_CREATED','SUBSCRIPTION_CANCELLED','PAYMENT_REGISTERED','PAYMENT_VOIDED','SCHEDULE_CREATED','SCHEDULE_UPDATED','SCHEDULE_ACTIVATED','SCHEDULE_DEACTIVATED','ENROLLMENT_CREATED','ENROLLMENT_ENDED','ENROLLMENT_SCHEDULE_CHANGED','CLASS_SESSIONS_GENERATED','CLASS_SESSION_CAPACITY_CHANGED','CLASS_SESSION_TIME_CHANGED','CLASS_SESSION_CANCELLED','ATTENDANCE_CHALLENGE_ISSUED','RECOVERY_AUTHORIZED','RECOVERY_CANCELLED') THEN 'ADMIN'
 WHEN "actorId" IS NOT NULL AND "action" IN ('STUDENT_ACCESS_ACTIVATED','ATTENDANCE_PRESENT_RECORDED') THEN 'STUDENT'
 WHEN "actorId" IS NULL AND "action" = 'CLASS_SESSION_ATTENDANCE_RECONCILED' THEN 'SYSTEM'
 WHEN "actorId" IS NOT NULL AND "action" = 'SESSION_REVOKED' AND "metadata"->>'role' IN ('ADMIN','STUDENT') THEN "metadata"->>'role'
 ELSE NULL END) IS NULL) THEN
  RAISE EXCEPTION 'AuditLog actor attribution requires explicit review before Stage 7' USING ERRCODE = 'check_violation';
 END IF;
END $$;
-- PostgreSQL requires a new enum value to commit before use in constraints.
ALTER TYPE "AttendanceSource" ADD VALUE 'ADMIN';
COMMIT;
BEGIN;
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN','STUDENT','SYSTEM');
ALTER TABLE "AuditLog" ADD COLUMN "actorType" "AuditActorType";
UPDATE "AuditLog" SET "actorType" = (CASE
 WHEN "actorId" IS NOT NULL AND "action" IN ('ADMIN_LOGIN','STUDENT_ACCESS_CREATED','STUDENT_ACCESS_REVOKED','STUDENT_CREATED','STUDENT_UPDATED','STUDENT_DEACTIVATED','STUDENT_REACTIVATED','PLAN_CREATED','PLAN_UPDATED','PLAN_ACTIVATED','PLAN_DEACTIVATED','SUBSCRIPTION_CREATED','SUBSCRIPTION_CANCELLED','PAYMENT_REGISTERED','PAYMENT_VOIDED','SCHEDULE_CREATED','SCHEDULE_UPDATED','SCHEDULE_ACTIVATED','SCHEDULE_DEACTIVATED','ENROLLMENT_CREATED','ENROLLMENT_ENDED','ENROLLMENT_SCHEDULE_CHANGED','CLASS_SESSIONS_GENERATED','CLASS_SESSION_CAPACITY_CHANGED','CLASS_SESSION_TIME_CHANGED','CLASS_SESSION_CANCELLED','ATTENDANCE_CHALLENGE_ISSUED','RECOVERY_AUTHORIZED','RECOVERY_CANCELLED') THEN 'ADMIN'
 WHEN "actorId" IS NOT NULL AND "action" IN ('STUDENT_ACCESS_ACTIVATED','ATTENDANCE_PRESENT_RECORDED') THEN 'STUDENT'
 WHEN "actorId" IS NULL AND "action" = 'CLASS_SESSION_ATTENDANCE_RECONCILED' THEN 'SYSTEM'
 WHEN "actorId" IS NOT NULL AND "action" = 'SESSION_REVOKED' AND "metadata"->>'role' IN ('ADMIN','STUDENT') THEN "metadata"->>'role'
 ELSE NULL END)::"AuditActorType";
ALTER TABLE "AuditLog" ALTER COLUMN "actorType" SET NOT NULL,
 ADD CONSTRAINT "AuditLog_actor_check" CHECK (("actorType" = 'SYSTEM' AND "actorId" IS NULL) OR ("actorType" <> 'SYSTEM' AND "actorId" IS NOT NULL));
DROP INDEX "AuditLog_createdAt_idx";
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt","id");
CREATE INDEX "AuditLog_actorType_actorId_createdAt_id_idx" ON "AuditLog"("actorType","actorId","createdAt","id");
CREATE INDEX "AuditLog_action_createdAt_id_idx" ON "AuditLog"("action","createdAt","id");
ALTER TABLE "Attendance" ADD COLUMN "originalStatus" "AttendanceStatus",
 ADD COLUMN "createdByAdminId" TEXT, ADD COLUMN "creationReason" VARCHAR(500);
UPDATE "Attendance" SET "originalStatus" = "status";
ALTER TABLE "Attendance" ALTER COLUMN "originalStatus" SET NOT NULL,
 DROP CONSTRAINT "Attendance_source_status_check",
 ADD CONSTRAINT "Attendance_source_original_status_check" CHECK (
  ("source" IN ('STUDENT','ADMIN') AND "originalStatus" = 'PRESENT') OR ("source" = 'SYSTEM' AND "originalStatus" = 'ABSENT')),
 ADD CONSTRAINT "Attendance_manual_admin_check" CHECK (
  ("source" = 'ADMIN' AND "createdByAdminId" IS NOT NULL AND "creationReason" IS NOT NULL AND length(trim("creationReason")) BETWEEN 3 AND 500)
  OR ("source" <> 'ADMIN' AND "createdByAdminId" IS NULL AND "creationReason" IS NULL)),
 ADD CONSTRAINT "Attendance_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "AttendanceCorrection" (
 "id" TEXT PRIMARY KEY, "attendanceId" TEXT NOT NULL, "sequence" INTEGER NOT NULL,
 "previousStatus" "AttendanceStatus" NOT NULL, "targetStatus" "AttendanceStatus" NOT NULL,
 "reason" VARCHAR(500) NOT NULL, "correctedByAdminId" TEXT NOT NULL,
 "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AttendanceCorrection_transition_check" CHECK ("previousStatus" <> "targetStatus"),
 CONSTRAINT "AttendanceCorrection_reason_check" CHECK (length(trim("reason")) BETWEEN 3 AND 500),
 CONSTRAINT "AttendanceCorrection_sequence_check" CHECK ("sequence" > 0),
 CONSTRAINT "AttendanceCorrection_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "AttendanceCorrection_correctedByAdminId_fkey" FOREIGN KEY ("correctedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AttendanceCorrection_attendanceId_sequence_key" ON "AttendanceCorrection"("attendanceId","sequence");
CREATE INDEX "AttendanceCorrection_correctedByAdminId_idx" ON "AttendanceCorrection"("correctedByAdminId");
CREATE FUNCTION "guard_attendance_correction_history"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'AttendanceCorrection history is immutable' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER "AttendanceCorrection_history_guard" BEFORE UPDATE OR DELETE ON "AttendanceCorrection" FOR EACH ROW EXECUTE FUNCTION "guard_attendance_correction_history"();
CREATE OR REPLACE FUNCTION "guard_recovery_history"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original "Attendance"%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Recovery history cannot be deleted' USING ERRCODE = 'check_violation'; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."studentId", NEW."subscriptionId", NEW."originalAbsenceId", NEW."recoverySessionId", NEW."authorizedByAdminId", NEW."authorizedAt")
    IS DISTINCT FROM (OLD."studentId", OLD."subscriptionId", OLD."originalAbsenceId", OLD."recoverySessionId", OLD."authorizedByAdminId", OLD."authorizedAt") THEN
    RAISE EXCEPTION 'Recovery authorization is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."cancelledAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Recovery cancellation is immutable' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO original FROM "Attendance" WHERE "id" = NEW."originalAbsenceId" FOR SHARE;
  IF NOT FOUND OR (NEW."cancelledAt" IS NULL AND original."status" <> 'ABSENT') OR original."recoveryId" IS NOT NULL OR original."classSessionId" = NEW."recoverySessionId" THEN
    RAISE EXCEPTION 'Recovery requires a normal absence in a different class' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."cancelledAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "Attendance" WHERE "recoveryId" = NEW."id") THEN
    RAISE EXCEPTION 'Recovery with attendance cannot be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;


CREATE OR REPLACE FUNCTION "guard_recovery_attendance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recovery_record "Recovery"%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" IS DISTINCT FROM NEW."originalStatus" THEN
    RAISE EXCEPTION 'New Attendance must start at originalStatus' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."recoveryId", NEW."studentId", NEW."subscriptionId", NEW."classSessionId", NEW."id", NEW."originalStatus", NEW."source", NEW."recordedAt", NEW."createdByAdminId", NEW."creationReason")
    IS DISTINCT FROM (OLD."recoveryId", OLD."studentId", OLD."subscriptionId", OLD."classSessionId", OLD."id", OLD."originalStatus", OLD."source", OLD."recordedAt", OLD."createdByAdminId", OLD."creationReason") THEN
    RAISE EXCEPTION 'Attendance consumption identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" <> 'ABSENT' AND EXISTS (SELECT 1 FROM "Recovery" WHERE "originalAbsenceId" = OLD."id" AND "cancelledAt" IS NULL) THEN
    RAISE EXCEPTION 'Recovery origin must remain ABSENT' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."recoveryId" IS NOT NULL THEN
    SELECT * INTO recovery_record FROM "Recovery" WHERE "id" = NEW."recoveryId" FOR SHARE;
    IF NOT FOUND OR recovery_record."cancelledAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Recovery authorization is unavailable' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

COMMIT;
