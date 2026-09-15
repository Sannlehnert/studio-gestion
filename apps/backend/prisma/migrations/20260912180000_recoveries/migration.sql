-- Provisional rows have no trustworthy Admin authorization or recovery result.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Recovery") THEN
    RAISE EXCEPTION 'Recovery upgrade requires an explicit mapping of provisional authorizations' USING ERRCODE = 'check_violation';
  END IF;
END $$;
BEGIN;
ALTER TABLE "Recovery" DROP CONSTRAINT "Recovery_originalAbsenceId_fkey";
DROP INDEX "Recovery_originalAbsenceId_key";
DROP INDEX "Recovery_studentId_subscriptionId_idx";
ALTER TABLE "Recovery" DROP COLUMN "status", DROP COLUMN "createdAt", DROP COLUMN "usedAt", DROP COLUMN "expiresAt", DROP COLUMN "note";
DROP TYPE "RecoveryStatus";
ALTER TABLE "Recovery"
  ADD COLUMN "authorizedByAdminId" TEXT NOT NULL,
  ADD COLUMN "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByAdminId" TEXT,
  ADD COLUMN "cancellationReason" VARCHAR(500),
  ADD CONSTRAINT "Recovery_cancellation_check" CHECK (
    ("cancelledAt" IS NULL AND "cancelledByAdminId" IS NULL AND "cancellationReason" IS NULL)
    OR ("cancelledAt" IS NOT NULL AND "cancelledByAdminId" IS NOT NULL AND "cancellationReason" IS NOT NULL
      AND "cancelledAt" >= "authorizedAt" AND length(trim("cancellationReason")) BETWEEN 3 AND 500)
  ),
  ADD CONSTRAINT "Recovery_authorizedByAdminId_fkey" FOREIGN KEY ("authorizedByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Recovery_cancelledByAdminId_fkey" FOREIGN KEY ("cancelledByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD COLUMN "recoveryId" TEXT;
CREATE UNIQUE INDEX "Attendance_id_studentId_subscriptionId_key" ON "Attendance"("id", "studentId", "subscriptionId");
CREATE UNIQUE INDEX "Attendance_recovery_identity_key" ON "Attendance"("recoveryId", "studentId", "subscriptionId", "classSessionId");
CREATE UNIQUE INDEX "Attendance_recoveryId_key" ON "Attendance"("recoveryId");
CREATE UNIQUE INDEX "Recovery_id_studentId_subscriptionId_recoverySessionId_key" ON "Recovery"("id", "studentId", "subscriptionId", "recoverySessionId");
ALTER TABLE "Recovery" ADD CONSTRAINT "Recovery_originalAbsenceId_studentId_subscriptionId_fkey"
  FOREIGN KEY ("originalAbsenceId", "studentId", "subscriptionId") REFERENCES "Attendance"("id", "studentId", "subscriptionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_recoveryId_studentId_subscriptionId_classSessionId_fkey"
  FOREIGN KEY ("recoveryId", "studentId", "subscriptionId", "classSessionId") REFERENCES "Recovery"("id", "studentId", "subscriptionId", "recoverySessionId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Recovery_one_effective_absence_key" ON "Recovery"("originalAbsenceId") WHERE "cancelledAt" IS NULL;
CREATE UNIQUE INDEX "Recovery_one_effective_student_session_key" ON "Recovery"("studentId", "recoverySessionId") WHERE "cancelledAt" IS NULL;
CREATE INDEX "Recovery_originalAbsenceId_authorizedAt_idx" ON "Recovery"("originalAbsenceId", "authorizedAt");
CREATE INDEX "Recovery_studentId_authorizedAt_id_idx" ON "Recovery"("studentId", "authorizedAt", "id");

-- Cross-table facts cannot be ordinary CHECKs. Structured FKs protect identity;
-- these guards protect origin and immutability, independently of HTTP DTOs.
CREATE FUNCTION "guard_recovery_history"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NOT FOUND OR original."status" <> 'ABSENT' OR original."recoveryId" IS NOT NULL OR original."classSessionId" = NEW."recoverySessionId" THEN
    RAISE EXCEPTION 'Recovery requires a normal absence in a different class' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."cancelledAt" IS NOT NULL AND EXISTS (SELECT 1 FROM "Attendance" WHERE "recoveryId" = NEW."id") THEN
    RAISE EXCEPTION 'Recovery with attendance cannot be cancelled' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "Recovery_history_guard" BEFORE INSERT OR UPDATE OR DELETE ON "Recovery" FOR EACH ROW EXECUTE FUNCTION "guard_recovery_history"();

CREATE FUNCTION "guard_recovery_attendance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recovery_record "Recovery"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."recoveryId", NEW."studentId", NEW."subscriptionId", NEW."classSessionId")
    IS DISTINCT FROM (OLD."recoveryId", OLD."studentId", OLD."subscriptionId", OLD."classSessionId") THEN
    RAISE EXCEPTION 'Attendance consumption identity is immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."status" <> 'ABSENT' AND EXISTS (SELECT 1 FROM "Recovery" WHERE "originalAbsenceId" = OLD."id") THEN
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
CREATE TRIGGER "Attendance_recovery_guard" BEFORE INSERT OR UPDATE ON "Attendance" FOR EACH ROW EXECUTE FUNCTION "guard_recovery_attendance"();
COMMIT;
