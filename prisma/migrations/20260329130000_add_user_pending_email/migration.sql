-- Idempotent: init may already include pendingEmail (squashed schema).

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingEmail" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "users_pendingEmail_key" ON "users"("pendingEmail");
