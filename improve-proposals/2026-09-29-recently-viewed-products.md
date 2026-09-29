# Recently viewed products on the marketplace list

## Problem / opportunity

Once a shopper opens a product from the infinite-scroll list
(`ProductListScreen.tsx` / `ProductListScreen.web.tsx`) and backs out — or
closes the app and comes back later — there is no way to get back to it
except re-searching (`useProductSearch.ts`) or scrolling to find it again.
This is distinct from the two existing proposals in this folder: the
sort/price-filter proposal narrows the *current* list by explicit criteria,
and the wishlist proposal requires the shopper to explicitly opt in to
saving an item. Recently-viewed is passive and implicit — it just reflects
"what did I already look at," which is what a shopper actually wants when
they think "wait, what was that thing I clicked on 5 minutes ago." It's a
standard marketplace pattern (Amazon, Etsy, etc.) and is cheap to build
because `ProductDetailScreen.tsx` already loads the exact `ProductData`
needed to record a view.

## Proposed approach

Mirror the cart/wishlist pattern already established in this repo: a small
persisted client-side store in `components-library`, updated from
`ProductDetailScreen`, and rendered back on the list screen — all shared
logic, no platform-specific implementation.

1. **Shared store** — add
   `components-library/src/business/ProductDetailScreen/useRecentlyViewedStore.ts`,
   a zustand store holding an ordered list of recently viewed products
   (most-recent-first, capped at e.g. 10 entries, de-duplicated by moving an
   already-seen product to the front instead of adding a second entry).
   Persist it the same way `useCartStore.ts` does: `localStorage` on web
   (full page reloads via `MainNav`'s `<a href>`), in-memory fallback on
   native. Expose `recordView(product: ProductData)` and a `items:
   ProductData[]` selector.

2. **Record a view** — in
   `components-library/src/business/ProductDetailScreen/ProductDetailScreen.tsx`,
   call `recordView(product)` in a `useEffect` keyed on `product?.id` once
   the product has loaded (guarding on `product` being non-null, same as
   the existing "Product not found" branch already does). No prop changes
   needed on the per-app detail pages
   (`web-application/app/marketplace/[id]/page.tsx`,
   `mobile-application/src/app/(tabs)/marketplace/[id].tsx`) — like the
   cart's `addItem`, this stays entirely inside the shared screen.

3. **Render the rail, shared** — in
   `components-library/src/business/ProductListScreen/ProductListScreen.tsx`
   and `ProductListScreen.web.tsx`, read `useRecentlyViewedStore` and, when
   non-empty and the search query is blank, render a horizontal
   "Recently viewed" row above the main grid using the existing `Product`
   card component (no new card variant). Hide the rail once the shopper
   starts typing in `SearchInput`, so it doesn't compete with active search
   results. Exclude the product currently being viewed only matters on the
   detail screen, not here, so no extra filtering is needed on the list.

4. **Empty/initial state** — nothing renders when the store is empty (new
   shopper, cleared storage) — no separate empty-state copy needed, since
   this is a bonus section, not a primary piece of list UI.

## Key files/areas

- New: `components-library/src/business/ProductDetailScreen/useRecentlyViewedStore.ts`
  (+ `useRecentlyViewedStore.test.ts` mirroring `useCartStore.test.ts`)
- Edit: `components-library/src/business/ProductDetailScreen/ProductDetailScreen.tsx`
  (record view on load)
- Edit: `components-library/src/business/ProductListScreen/ProductListScreen.tsx`
  and `ProductListScreen.web.tsx` (render the "Recently viewed" rail)
- Edit: `components-library/src/business/ProductListScreen/ProductListScreen.web.test.tsx`
  and `ProductDetailScreen.web.test.tsx` to cover the new behavior
- Edit: `components-library/src/index.ts` to export the new store if it
  needs to be consumed outside the two screens (likely not needed —
  both read/write sites are inside `components-library`)
- No changes needed to `web-application/app/marketplace/*`,
  `mobile-application/src/app/(tabs)/marketplace/*`, the API layer, or
  `ProductData`/`ProductsPage` types.

## Verification

- Unit tests for `useRecentlyViewedStore.ts`: recording a view adds it to
  the front, re-viewing an already-recorded product moves it to the front
  without duplicating, the list is capped at the max size, persistence
  round-trips through the storage adapter.
- `ProductDetailScreen.web.test.tsx` extended: loading a product records it
  in the store exactly once (not on every re-render), and loading errors /
  "not found" don't record anything.
- `ProductListScreen.web.test.tsx` extended: the rail appears only when the
  store is non-empty, hides while a search query is active, and reflects
  store updates.
- Manual pass on both apps: view two or three different products, return to
  the marketplace list, confirm the rail shows them most-recent-first,
  confirm it persists across a web reload, and confirm typing in search
  hides it and clearing search brings it back.
