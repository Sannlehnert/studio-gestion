-- Student.isActive only describes the present. Rebuild the known active
-- intervals once from the transition audit trail, but refuse any sequence
-- whose timestamps or final state cannot be justified.
DO $$
DECLARE
  student_row RECORD;
  event_row RECORD;
  derived_active BOOLEAN;
  previous_event_at TIMESTAMP(3);
BEGIN
  FOR student_row IN
    SELECT "id", "isActive", "createdAt" FROM "Student" ORDER BY "id"
  LOOP
    derived_active := true;
    previous_event_at := NULL;

    FOR event_row IN
      SELECT "id", "action", "createdAt"
      FROM "AuditLog"
      WHERE "entity" = 'Student'
        AND "entityId" = student_row."id"
        AND "action" IN ('STUDENT_DEACTIVATED', 'STUDENT_REACTIVATED')
      ORDER BY "createdAt", "id"
    LOOP
      IF event_row."createdAt" < student_row."createdAt" THEN
        RAISE EXCEPTION 'Student % has a status transition before creation', student_row."id"
          USING ERRCODE = 'check_violation';
      END IF;
      IF previous_event_at IS NOT NULL
        AND event_row."createdAt" = previous_event_at THEN
        RAISE EXCEPTION 'Student % has ambiguous simultaneous status transitions', student_row."id"
          USING ERRCODE = 'check_violation';
      END IF;

      IF event_row."action" = 'STUDENT_DEACTIVATED' THEN
        IF NOT derived_active THEN
          RAISE EXCEPTION 'Student % has an invalid deactivate sequence', student_row."id"
            USING ERRCODE = 'check_violation';
        END IF;
        derived_active := false;
      ELSE
        IF derived_active THEN
          RAISE EXCEPTION 'Student % has an invalid reactivate sequence', student_row."id"
            USING ERRCODE = 'check_violation';
        END IF;
        derived_active := true;
      END IF;
      previous_event_at := event_row."createdAt";
    END LOOP;

    IF derived_active IS DISTINCT FROM student_row."isActive" THEN
      RAISE EXCEPTION 'Student % current status cannot be reconstructed from AuditLog', student_row."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
END $$;

BEGIN;

CREATE TABLE "StudentActivePeriod" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudentActivePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StudentActivePeriod_valid_period_check" CHECK (
    "validUntil" IS NULL OR "validFrom" <= "validUntil"
  )
);

DO $$
DECLARE
  student_row RECORD;
  event_row RECORD;
  active_from TIMESTAMP(3);
  active_state BOOLEAN;
BEGIN
  FOR student_row IN
    SELECT "id", "createdAt" FROM "Student" ORDER BY "id"
  LOOP
    active_from := student_row."createdAt";
    active_state := true;

    FOR event_row IN
      SELECT "action", "createdAt"
      FROM "AuditLog"
      WHERE "entity" = 'Student'
        AND "entityId" = student_row."id"
        AND "action" IN ('STUDENT_DEACTIVATED', 'STUDENT_REACTIVATED')
      ORDER BY "createdAt", "id"
    LOOP
      IF event_row."action" = 'STUDENT_DEACTIVATED' THEN
        IF active_from < event_row."createdAt" THEN
          INSERT INTO "StudentActivePeriod" (
            "id", "studentId", "validFrom", "validUntil"
          ) VALUES (
            gen_random_uuid()::text,
            student_row."id",
            active_from,
            event_row."createdAt"
          );
        END IF;
        active_state := false;
      ELSE
        active_from := event_row."createdAt";
        active_state := true;
      END IF;
    END LOOP;

    IF active_state THEN
      INSERT INTO "StudentActivePeriod" (
        "id", "studentId", "validFrom", "validUntil"
      ) VALUES (
        gen_random_uuid()::text,
        student_row."id",
        active_from,
        NULL
      );
    END IF;
  END LOOP;
END $$;

CREATE INDEX "StudentActivePeriod_studentId_validFrom_validUntil_idx"
  ON "StudentActivePeriod"("studentId", "validFrom", "validUntil");
CREATE UNIQUE INDEX "StudentActivePeriod_one_open_period_key"
  ON "StudentActivePeriod"("studentId") WHERE "validUntil" IS NULL;

ALTER TABLE "StudentActivePeriod"
  ADD CONSTRAINT "StudentActivePeriod_no_overlap"
  EXCLUDE USING gist (
    "studentId" WITH =,
    tsrange("validFrom", "validUntil", '[)') WITH &&
  );

ALTER TABLE "StudentActivePeriod"
  ADD CONSTRAINT "StudentActivePeriod_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "create_initial_student_active_period"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."isActive" THEN
    INSERT INTO "StudentActivePeriod" (
      "id", "studentId", "validFrom", "validUntil"
    ) VALUES (
      gen_random_uuid()::text,
      NEW."id",
      NEW."createdAt",
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Student_create_initial_active_period"
AFTER INSERT ON "Student"
FOR EACH ROW EXECUTE FUNCTION "create_initial_student_active_period"();

CREATE FUNCTION "assert_student_active_projection"()
RETURNS TRIGGER AS $$
DECLARE
  checked_student_id TEXT;
  projected_active BOOLEAN;
  has_open_period BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'Student' THEN
    checked_student_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    checked_student_id := OLD."studentId";
  ELSE
    checked_student_id := NEW."studentId";
  END IF;

  SELECT "isActive" INTO projected_active
  FROM "Student"
  WHERE "id" = checked_student_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM "StudentActivePeriod"
    WHERE "studentId" = checked_student_id
      AND "validUntil" IS NULL
  ) INTO has_open_period;

  IF projected_active IS DISTINCT FROM has_open_period THEN
    RAISE EXCEPTION 'Student % isActive projection does not match active-period history', checked_student_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Student_active_projection_consistency"
AFTER INSERT OR UPDATE ON "Student"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_student_active_projection"();

CREATE CONSTRAINT TRIGGER "StudentActivePeriod_projection_consistency"
AFTER INSERT OR UPDATE OR DELETE ON "StudentActivePeriod"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_student_active_projection"();

CREATE FUNCTION "prevent_student_active_period_delete"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Student active-period history cannot be deleted'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StudentActivePeriod_prevent_delete"
BEFORE DELETE ON "StudentActivePeriod"
FOR EACH ROW EXECUTE FUNCTION "prevent_student_active_period_delete"();

COMMIT;
