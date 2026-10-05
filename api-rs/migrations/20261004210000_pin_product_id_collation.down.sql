-- Reverses 20261004210000_pin_product_id_collation: both list indexes go back
-- to inheriting the database's default collation, which is what made the
-- tiebreaker depend on a cluster setting this repository never pinned.
DROP INDEX "Product_createdAt_id_idx";
CREATE INDEX "Product_createdAt_id_idx" ON "Product"("createdAt", "id");

DROP INDEX "Product_ownerId_createdAt_id_idx";
CREATE INDEX "Product_ownerId_createdAt_id_idx"
    ON "Product"("ownerId", "createdAt", "id");