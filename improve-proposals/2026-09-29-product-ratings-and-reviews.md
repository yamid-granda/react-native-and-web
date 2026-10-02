# Product ratings and reviews

## Problem / opportunity

`ProductData` (`components-library/src/types/Product.ts`) and the
`Product` model (`api-rs/prisma/schema.prisma`) carry no notion
of quality signal at all — a shopper has nothing but a title, description,
image, and price to decide whether a product is any good.
`ProductDetailScreen.tsx` (the one place a shopper commits to a purchase)
shows exactly the same four fields as the `Product.tsx` list card, plus an
"Add to Cart" button. Every other proposal in this folder is about
*finding*/*tracking* products (recently-viewed, sort/price-filter,
wishlist) or *stock status*; none of them add any social-proof or
user-generated content. A star rating and a short list of written reviews
is one of the highest-leverage, most standard e-commerce trust signals and
is a distinct, additive feature — a genuinely new kind of data (server-
persisted, user-authored) that nothing else here introduces.

## Proposed approach

Add reviews as a new server-owned resource scoped to a product, expose an
aggregate rating alongside each `ProductData`, and surface both the
aggregate and the review list from the two shared screens that already
render product info — following the repo's "shared logic in
`components-library`, thin per-app wrapper" convention, with no
platform-specific review UI.

1. **Schema + migration** — add a `Review` model to
   `api-rs/prisma/schema.prisma`: `id`, `productId` (FK to `Product`,
   `onDelete: Cascade`), `rating Int` (1-5), `comment String?`,
   `authorName String`, `createdAt DateTime @default(now())`. Generate a
   migration (`pnpm --filter @rnw/api-rs db:migrate`) and add a varied mix of
   ratings/comments per product to `api-rs/prisma/seed.ts` (including some
   products with zero reviews) so the "no reviews yet" state is exercisable
   locally.

2. **API** — api-rs is a Rust/Axum service, so this means a new handler module
   under `api-rs/src/handlers/` plus store methods in `api-rs/src/store/`
   (mirroring how `products` is split today):
   - `GET /products/:id/reviews` — paginated list of a product's reviews,
     newest first (same `page`/`limit`/`hasNextPage` shape
     `handlers/products.rs` already returns, for consistency).
   - `POST /products/:id/reviews` — create a review (`rating`,
     `comment?`, `authorName`); validate `rating` is an integer 1-5 and
     reject otherwise with the same `{message, error, statusCode}` error
     body every other failure uses (`api-rs/src/error.rs`).
   Extend the products list/detail queries
   (`api-rs/src/store/products.rs`) to compute and include `averageRating`
   and `reviewCount` per product (a `LEFT JOIN` + `GROUP BY` aggregate, or a
   grouped query if that's cheaper at the list page level) so the list
   endpoint doesn't require N+1 calls to show a rating on every card.

   Note this proposal turns api-rs into a write path. `GET /products*` is
   currently safe to cache at the L1/L2/Cloudflare tiers under the blanket
   `EDGE_CACHE_CONTROL`; any new mutating route needs its own cache policy,
   and the review aggregates must be invalidated on write or the list will
   serve stale ratings.

3. **Shared type** — add `averageRating?: number` and `reviewCount: number`
   to `ProductData`, and a new `ReviewData` type (`id`, `rating`,
   `comment?`, `authorName`, `createdAt`) in
   `components-library/src/types/Product.ts` (or a sibling
   `Review.ts` alongside it).

4. **Rating display, shared** — add
   `components-library/src/common/RatingStars/RatingStars.tsx`: a small
   read-only star-rating renderer taking `rating` and `reviewCount`, used
   in both `common/Product/Product.tsx` (under the title, above price) and
   `business/ProductDetailScreen/ProductDetailScreen.tsx`. Render nothing
   when `reviewCount === 0`, consistent with how both components already
   omit optional fields (e.g. `description`).

5. **Review list + submission, shared** — add
   `components-library/src/business/ProductDetailScreen/ReviewsSection.tsx`,
   rendered below the existing "Add to Cart" button in
   `ProductDetailScreen.tsx`: fetches/paginates via the new endpoint, shows
   `authorName`, `rating`, `comment`, `createdAt` per review, an empty
   state ("No reviews yet — be the first to review this product."), and a
   small form (star picker + `authorName` + `comment` text input, reusing
   `common/Input/Input.tsx` and `common/Button/Button.tsx`) that posts a
   new review and prepends it to the list on success. All data-fetching
   stays inside `components-library` via the same `@tanstack/react-query`
   pattern `ProductListScreen`/`ProductDetailScreen` already use for
   products — no prop changes needed on
   `web-application/app/marketplace/[id]/page.tsx` or
   `mobile-application/src/app/(tabs)/marketplace/[id].tsx`.

## Key files/areas

- New: `api-rs/src/handlers/reviews.rs`, store methods in
  `api-rs/src/store/reviews.rs`
- Edit: `api-rs/prisma/schema.prisma` (new `Review` model) + generated
  migration under `api-rs/prisma/migrations/`
- Edit: `api-rs/prisma/seed.ts` (seed varied ratings/reviews)
- Edit: `api-rs/src/store/products.rs` + `api-rs/src/handlers/products.rs` to
  include `averageRating`/`reviewCount` in list/detail
- Edit: `components-library/src/types/Product.ts` (extend `ProductData`,
  add `ReviewData`)
- New: `components-library/src/common/RatingStars/RatingStars.tsx` (+
  `.stories.tsx`, `.web.test.tsx`)
- New:
  `components-library/src/business/ProductDetailScreen/ReviewsSection.tsx`
  (+ `.web.test.tsx`)
- Edit: `components-library/src/common/Product/Product.tsx` (render
  `RatingStars`)
- Edit: `components-library/src/business/ProductDetailScreen/ProductDetailScreen.tsx`
  (render `RatingStars` + `ReviewsSection`)
- No changes needed to `web-application/app/marketplace/*`,
  `mobile-application/src/app/(tabs)/marketplace/*`, `CartScreen.tsx`,
  `CheckoutScreen.tsx`, or `useCartStore.ts`.

## Verification

- API: Rust unit tests for the review handler/store covering pagination,
  rating-range validation (rejects 0, 6, non-integers), and cascade delete if
  a product is removed; a hermetic E2E case in
  `api-rs/tests/e2e_products.rs` asserting `averageRating`/`reviewCount` are
  correct for a product with reviews and default sensibly (e.g.
  `reviewCount: 0`, no `averageRating`) for one with none.
- `RatingStars.web.test.tsx`: renders the correct filled/empty star count
  per rating value, renders nothing at `reviewCount === 0`.
- `Product.web.test.tsx` and `ProductDetailScreen.web.test.tsx` extended:
  rating renders when present and is omitted when absent.
- New `ReviewsSection.web.test.tsx`: empty state renders with no reviews,
  submitting the form posts a review and it appears in the list, invalid
  submissions (missing rating) are blocked client-side.
- Manual pass on both apps: open a product with existing reviews and one
  with none, confirm star rating and review list render correctly on both
  platforms, submit a new review from the detail screen and confirm it
  appears immediately and the list card's rating updates on next load.
