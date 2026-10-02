# Server-side product search across the full catalog

## Problem / opportunity

`useProductSearch.ts`
(`components-library/src/business/ProductListScreen/useProductSearch.ts`)
filters by substring match entirely client-side, and — as its own comment
says — "only matches against products already fetched — search doesn't
query further pages." The marketplace list loads products a page at a
time via infinite scroll (`useInfiniteProducts.ts`), and the API itself
has no search capability at all: the list handler
(`api-rs/src/handlers/products.rs`) only accepts a `page` query
param, and its store query (`api-rs/src/store/products.rs`) is always
unfiltered and ordered by `createdAt`/`id`. The result is a search bar that
silently lies: typing a
query that matches a real product on page 6 shows "No products match ..."
if the shopper hasn't scrolled that far yet, because the search only ever
sees whatever pages happened to load first. This is a correctness gap in
the one discovery feature the marketplace already ships, and it's distinct
from every other proposal in this folder: the sort-and-price-filter
proposal explicitly keeps the "filter what's fetched so far" client-side
model and never touches the API or `findAll`, and none of the other
proposals (wishlist, recently-viewed, ratings, stock, order history,
checkout form) touch search or the products API at all.

## Proposed approach

Move query matching to the database so a search reflects the whole
catalog, not just already-loaded pages, while keeping pagination working
the same way it does today:

1. **API** — extend the list handler (`api-rs/src/handlers/products.rs`) to
   accept an optional `q` query param and thread it into the store call.
   In `api-rs/src/store/products.rs`, when `q` is present, add a `WHERE`
   clause to the list and count queries (case-insensitive `ILIKE '%q%'` on
   `title` OR `description`) instead of the current unfiltered query. Keep the
   existing ordering (`createdAt asc, id asc`) and pagination shape (`page`,
   `limit`, `total`, `hasNextPage`) unchanged so callers don't need new types.

   Two things to respect here: the cache keys in
   `api-rs/src/cache/` are derived from the request path, so `q` must be part
   of the key or different queries will collide; and `q` reaches the cache
   layer and the rate limiter as free-form user input, so it needs bounding
   (a length cap and, ideally, escaping) before it becomes a query string.

2. **API clients** — update `fetchProducts` in both
   `web-application/lib/api.ts` and `mobile-application/src/api/client.ts`
   to accept and forward an optional `q` alongside `page` (e.g.
   `fetchProducts(page = 1, q?: string)`), appending `&q=...` to the
   request URL when set.

3. **Shared hook** — extend `useInfiniteProducts.ts`
   (`components-library/src/business/ProductListScreen/useInfiniteProducts.ts`)
   to accept the current query, include it in the `queryKey` (so React
   Query treats each distinct query as its own paginated cache/reset), and
   pass it through to `fetchProducts` on every page fetch.

4. **List screen** — in `ProductListScreen.tsx` /
   `ProductListScreen.web.tsx`, keep `useProductSearch`'s existing
   `query`/`setQuery` as the debounced input source of truth (via
   `useDeferredValue`, already in place), but instead of using its
   client-side `results` as the rendered list, pass the deferred query up
   through a new prop (e.g. `onQueryChange`) so the owning page can re-run
   `useInfiniteProducts` with it. The two apps' pages
   (`web-application/app/marketplace/page.tsx`,
   `mobile-application/src/app/(tabs)/marketplace/index.tsx`) own the
   `useInfiniteProducts` call already, so they're the natural place to
   hold the active query and re-fetch when it changes — no new
   platform-specific code needed beyond that existing wiring.

5. **Empty state** — the existing "No products match "{query}"." copy in
   both list screens keeps working as-is, now correctly reflecting a
   server-confirmed empty result instead of an artifact of unloaded pages.

## Key files/areas

- Edit: `api-rs/src/handlers/products.rs`, `api-rs/src/store/products.rs`
  (+ cache-key handling in `api-rs/src/cache/`)
- Edit: `web-application/lib/api.ts`, `mobile-application/src/api/client.ts`
- Edit: `components-library/src/business/ProductListScreen/useInfiniteProducts.ts`
  (+ `useInfiniteProducts.web.test.tsx`)
- Edit: `components-library/src/business/ProductListScreen/useProductSearch.ts`
  (trim to just the debounced query value, or fold into the list screens)
- Edit: `components-library/src/business/ProductListScreen/ProductListScreen.tsx`,
  `ProductListScreen.web.tsx` (+ `.web.test.tsx`)
- Edit: `web-application/app/marketplace/page.tsx`,
  `mobile-application/src/app/(tabs)/marketplace/index.tsx`
- No changes needed to `ProductData`/`ProductsPage` types, the Prisma
  schema, `Product.tsx`, or any of `CartScreen`/`CheckoutScreen`.

## Verification

- Rust unit tests in `api-rs/src/store/products.rs`: `q` filters by title, by
  description, is case-insensitive, combines correctly with
  `page`/pagination boundaries, and an empty/absent `q` behaves exactly as
  today (no regression to the unfiltered default).
- `api-rs/src/handlers/products.rs` unit test: `q` query param is read and
  forwarded to the store alongside `page`.
- Cache test: two different `q` values for the same page produce different
  L1/L2 keys and neither returns the other's rows.
- `useInfiniteProducts` test: changing the query resets pagination and
  re-fetches from page 1 under a new cache key.
- `ProductListScreen.web.test.tsx` extended: typing a query that only
  matches a product on a later "page" (mocked fetcher) still surfaces it
  once the mocked request resolves, without requiring a manual scroll/
  `onEndReached` first.
- Manual pass on both apps against a seeded catalog with more products
  than one page: search for a title/description substring known to exist
  only past the first page and confirm it's found immediately.
