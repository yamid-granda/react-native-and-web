-- Pins the tiebreaker in "Product"'s list ordering to byte order.
--
-- LIST_QUERY and LIST_OWNED_QUERY order by ("createdAt" ASC, "id" ASC) and
-- "id" is TEXT, so without an explicit COLLATE Postgres resolves the tiebreaker
-- in the cluster's default collation. Production ids are mixed case —
-- generate_product_id() is base64 over CSPRNG bytes, alphabet A-Z a-z 0-9 - _ —
-- and under a glibc or ICU collation "a" sorts before "A" while under byte
-- order "A" (0x41) sorts before "a" (0x61). The two orders are opposite, not
-- merely different.
--
-- "C" is what InMemoryStore (String: Ord), the golden generator (Python's
-- sorted) and every other byte-comparing system in the toolchain already do, so
-- pinning it here makes the two implementations' agreement a property of the
-- schema rather than of the operator's locale.
--
-- Both indexes are rebuilt because a COLLATE "C" ORDER BY is only
-- index-satisfiable by an index carrying the same collation. Rebuilding the
-- index without changing the query text — or the reverse — silently turns the
-- hottest read in the service into a full sort per page, so the two halves of
-- this change must land together.
--
-- Plain CREATE INDEX, not CONCURRENTLY: sqlx runs each migration in a
-- transaction and CONCURRENTLY cannot run inside one. Same justification as
-- 20261002120000_add_product_list_index; the table is small at deploy time, so
-- the brief ACCESS EXCLUSIVE lock is acceptable.
--
-- One visible effect for an operator: a deployment already holding mixed-case
-- ids sees page boundaries shift ONCE, as rows settle into byte order. No row is
-- lost, moved or made unreadable — the catalogue is the same set either way —
-- and this reordering is the point of the change.
DROP INDEX "Product_createdAt_id_idx";
CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id" COLLATE "C");

-- The owner-scoped twin, same reasoning: the equality prefix on "ownerId" then
-- the same collation-pinned tiebreaker.
DROP INDEX "Product_ownerId_createdAt_id_idx";
CREATE INDEX "Product_ownerId_createdAt_id_idx"
    ON "Product"("ownerId", "createdAt", "id" COLLATE "C");