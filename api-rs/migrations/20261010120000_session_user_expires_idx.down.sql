-- Reverses 20261010120000_session_user_expires_idx. Restores the
-- single-column index; "Session_expiresAt_idx" is untouched by both directions.
DROP INDEX "Session_userId_expiresAt_idx";
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
