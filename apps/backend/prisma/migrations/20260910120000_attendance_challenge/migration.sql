BEGIN;
CREATE TABLE "AttendanceChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "generation" BIGSERIAL NOT NULL,
  "classSessionId" TEXT NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdByAdminId" TEXT NOT NULL,
  CONSTRAINT "AttendanceChallenge_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "AttendanceChallenge_revocation_check" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt"),
  CONSTRAINT "AttendanceChallenge_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AttendanceChallenge_classSessionId_fkey" FOREIGN KEY ("classSessionId") REFERENCES "ClassSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceChallenge_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "Admin"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AttendanceChallenge_tokenHash_key" ON "AttendanceChallenge"("tokenHash");
CREATE INDEX "AttendanceChallenge_classSessionId_generation_idx" ON "AttendanceChallenge"("classSessionId", "generation" DESC);
COMMIT;
