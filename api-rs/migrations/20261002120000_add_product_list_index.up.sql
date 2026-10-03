-- Backs the list query's ORDER BY ("createdAt" ASC, "id" ASC). Without it
-- every page sorts the whole table before LIMIT applies. The tuple matches
-- the ordering exactly, so Postgres walks the index and stops at the limit.
--
-- Plain CREATE INDEX, not CONCURRENTLY: sqlx runs each migration in a
-- transaction and CONCURRENTLY cannot run inside one. The table is small at
-- deploy time, so the brief ACCESS EXCLUSIVE lock is acceptable.
CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id");