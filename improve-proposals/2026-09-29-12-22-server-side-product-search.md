# Server-side product search across the full catalog

## Problem / opportunity

`useProductSearch.ts`
(`components-library/src/business/ProductListScreen/useProductSearch.ts`)
filters by substring match entirely client-side, and — as its own comment
says — "only matches against products already fetched — search doesn't
query further pages." The marketplace list loads products a page at a
time via infinite scroll (`useInfiniteProducts.ts`), and the API itself
has no search capability at all: `ProductsController.findAll`
(`api/src/products/products.controller.ts`) only accepts a `page` query
param, and `ProductsService.findAll` (`api/src/products/products.service.ts`)
always does an unfiltered `prisma.product.findMany` ordered by
`createdAt`/`id`. The result is a search bar that silently lies: typing a
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

1. **API** — extend `ProductsController.findAll` to accept an optional
   `q` query param and thread it into `ProductsService.findAll(page, q)`.
   In the service, when `q` is present, add a `where` clause to the
   `findMany`/`count` calls (case-insensitive `contains` on `title` and
   `description`, e.g. Prisma's `mode: "insensitive"` `OR` filter) instead
   of the current unfiltered query. Keep the existing ordering
   (`createdAt asc, id asc`) and pagination shape (`page`, `limit`,
   `total`, `hasNextPage`) unchanged so callers don't need new types.

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

- Edit: `api/src/products/products.controller.ts`,
  `api/src/products/products.service.ts` (+ their `.spec.ts` files)
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

- `ProductsService` unit tests: `q` filters by title, by description, is
  case-insensitive, combines correctly with `page`/pagination boundaries,
  and an empty/absent `q` behaves exactly as today (no regression to the
  unfiltered default).
- `ProductsController` unit test: `q` query param is read and forwarded to
  the service alongside `page`.
- `useInfiniteProducts` test: changing the query resets pagination and
  re-fetches from page 1 under a new cache key.
- `ProductListScreen.web.test.tsx` extended: typing a query that only
  matches a product on a later "page" (mocked fetcher) still surfaces it
  once the mocked request resolves, without requiring a manual scroll/
  `onEndReached` first.
- Manual pass on both apps against a seeded catalog with more products
  than one page: search for a title/description substring known to exist
  only past the first page and confirm it's found immediately.
