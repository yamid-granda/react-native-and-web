-- Gives a product an optional seller. Nullable so the seeded catalogue stays
-- ownerless and keeps working unchanged.
--
-- ON DELETE SET NULL, not CASCADE: a deleted seller must not silently delete
-- products other people may already have in a cart, a wishlist, or — once the
-- order-history proposal lands — a placed order. The rows fall back to being
-- anonymous listings, which is a recoverable state and a cascade is not.
ALTER TABLE "Product" ADD COLUMN "ownerId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Serves both owner-scoped queries: the seller's private My Store list and the
-- public store page. The equality prefix is "ownerId" and the sort is the same
-- ("createdAt" ASC, "id" ASC) as LIST_QUERY, so one index covers both and
-- neither has to sort. Inherits the same non-covering caveat (ARCHITECTURE.md
-- §11) as Product_createdAt_id_idx: the sort is gone, the heap fetch is not.
CREATE INDEX "Product_ownerId_createdAt_id_idx" ON "Product"("ownerId", "createdAt", "id");