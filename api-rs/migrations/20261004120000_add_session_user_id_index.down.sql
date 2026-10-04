-- Reverses 20261004120000_add_session_user_id_index. Drops only the index
-- added there; "Session_expiresAt_idx" predates it and is left in place.
DROP INDEX "Session_userId_idx";
