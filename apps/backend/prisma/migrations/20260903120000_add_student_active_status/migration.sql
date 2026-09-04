-- Student records are retained for history. Existing and new rows start active.
ALTER TABLE "Student" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
