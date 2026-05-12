-- Idempotent: init was later expanded to include these columns/tables. This migration must still
-- apply cleanly for databases created from an older init snapshot.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "onboardingCompletedAt" TIMESTAMP(3);

-- Original intent: treat pre-verification users as verified once the column exists
UPDATE "users" SET "emailVerified" = true WHERE "emailVerified" = false;

CREATE TABLE IF NOT EXISTS "email_verification_otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_otps_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "email_verification_otps_email_expiresAt_idx" ON "email_verification_otps"("email", "expiresAt");
