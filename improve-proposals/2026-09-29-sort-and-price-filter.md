# Sort and price-range filtering for the marketplace product list

## Problem / opportunity

The marketplace list (`ProductListScreen.tsx` / `ProductListScreen.web.tsx`)
only lets shoppers narrow results with a free-text substring match against
title/description (`useProductSearch.ts`). There is no way to sort (e.g.
price low→high) or to filter by price range, even though `ProductData`
already carries `price` (`components-library/src/types/Product.ts`). Once
the infinite-scroll list has accumulated more than a page or two of
products, finding "the cheapest thing in this category" or "everything
under $20" means scrolling through everything by hand. Sorting and a
price-range filter are standard marketplace primitives and a natural
extension of the search bar that's already there — distinct from the
wishlist/favorites proposal, which is about saving items, not narrowing
the list.

## Proposed approach

Keep the API's cursor/page-based `findAll` untouched for the default case,
and treat sort/price-filter as client-side refinements over the currently
loaded pages — the same "filter what's fetched so far" model
`useProductSearch` already uses for text search, so behavior stays
consistent (typing/filtering doesn't re-trigger network fetches) and no
`useInfiniteQuery` cache-key/pagination rework is needed:

1. **Shared hook** — extend `components-library/src/business/ProductListScreen/useProductSearch.ts`
   (or add a sibling `useProductFilters.ts` composed with it) to also accept
   a `sortBy: "relevance" | "price-asc" | "price-desc"` and a
   `priceRange: { min?: number; max?: number }`, applying price-range
   filtering before the existing substring match and sorting the result
   after. Keep it pure/memoized like the existing hook so it's covered by
   the same `useDeferredValue` treatment for the unbounded product list.

2. **Filter/sort UI, shared** — add
   `components-library/src/common/ProductFilterControls/ProductFilterControls.tsx`:
   a sort dropdown/segmented control plus two numeric min/max price
   inputs. On its own this is small enough to sit inline next to
   `SearchInput` in both `ProductListScreen.tsx` and
   `ProductListScreen.web.tsx` — no new platform-specific component needed,
   following the "shared component, thin per-app wrapper only for
   navigation/data" convention. If the combined control set doesn't fit
   comfortably above the grid/list on narrow widths, present it inside the
   existing `common/Drawer/Drawer.tsx` (already platform-agnostic via RN's
   `Modal`) behind a "Filters" button, same pattern either platform would
   use.

3. **Wire into both list screens** — `ProductListScreen.tsx` (native) and
   `ProductListScreen.web.tsx` both already call `useProductSearch`
   locally; extend both call sites to also pass through the new
   sort/price state to `ProductFilterControls` and into the filtering
   hook's output (`results`). No prop changes needed on
   `web-application/app/marketplace/page.tsx` or
   `mobile-application/src/app/(tabs)/marketplace/index.tsx` — like search,
   this stays entirely inside the shared screen component.

4. **Empty-state copy** — extend the existing "No products match ..."
   empty state in both list screens to also account for a price range that
   excludes all currently-loaded products, so shoppers aren't left staring
   at a blank list with no explanation.

## Key files/areas

- Edit: `components-library/src/business/ProductListScreen/useProductSearch.ts`
  (or new sibling hook composed alongside it)
- New: `components-library/src/common/ProductFilterControls/ProductFilterControls.tsx`
  (+ `.stories.tsx`, `.web.test.tsx`)
- Edit: `components-library/src/business/ProductListScreen/ProductListScreen.tsx`
- Edit: `components-library/src/business/ProductListScreen/ProductListScreen.web.tsx`
- Edit: `components-library/src/business/ProductListScreen/ProductListScreen.web.test.tsx`
  and any native-side test for the list screen, to cover sort/filter
- No changes needed to `web-application/app/marketplace/*`,
  `mobile-application/src/app/(tabs)/marketplace/*`, the API layer, or
  `ProductData`/`ProductsPage` types.

## Verification

- Unit tests for the filtering/sorting hook: price-range boundaries
  (inclusive min/max, no bound set), each sort order, and sort+filter+text
  search combined.
- `ProductListScreen.web.test.tsx` extended: selecting a sort order
  re-orders rendered cards; setting a price range hides out-of-range
  products; the new empty-state message appears when a price range
  excludes everything.
- Manual pass on both apps: apply a price range and a sort order, confirm
  the visible grid/list updates correctly, confirm it composes correctly
  with the existing text search, and confirm scrolling to fetch more pages
  still respects the active filter/sort once new products load in.
