-- Reverses 20261003120100_add_product_owner.
--
-- sqlx replays migrations newest-first, so this pair runs BEFORE the
-- 20261003120000 pair that drops "User" — which is the only reason the
-- "ownerId" foreign key is still resolvable when the column goes away. Drop
-- the index before the column: Postgres keeps the index alive on its own
-- anyway, but naming it explicitly keeps the two in a reviewable order.
DROP INDEX "Product_ownerId_createdAt_id_idx";
ALTER TABLE "Product" DROP COLUMN "ownerId";