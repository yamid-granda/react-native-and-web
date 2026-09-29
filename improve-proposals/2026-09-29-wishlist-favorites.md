# Wishlist / Favorites for marketplace products

## Problem / opportunity

The marketplace currently only supports two actions on a product: view it
and add it to the cart (`ProductDetailScreen.tsx`, `Product.tsx`). There is
no way for a shopper to save a product they're interested in without
committing to buying it right away. Browsing an infinite-scroll product
list (`ProductListScreen.tsx`) makes it easy to lose track of something
seen earlier — the only way back to it today is re-searching
(`useProductSearch.ts`) or scrolling to find it again. A wishlist/favorites
list is a standard, well-understood e-commerce pattern that directly
addresses this and is a natural companion to the existing cart feature,
whose store (`useCartStore.ts`) already gives us a proven pattern to mirror
(per-product-id keyed record, persisted via `zustand/middleware`).

## Proposed approach

Follow the exact shape of the existing cart feature, since it's the
closest analogous feature in the codebase and this repo's convention is
"shared logic in `components-library`, thin per-app wrappers in
`web-application`/`mobile-application`":

1. **Shared store** — add
   `components-library/src/business/WishlistScreen/useWishlistStore.ts`,
   a zustand store shaped like `useCartStore.ts`: `items: Record<string,
   ProductData>`, `toggleItem(product)`, `removeItem(id)`, `isWishlisted(id)`
   selector helper, persisted with the same `localStorage` /
   in-memory-fallback split `useCartStore.ts` already uses (same rationale:
   web navigation is a full page reload via `MainNav`'s `<a href>`, native
   navigation isn't).

2. **Toggle affordance on the product card and detail screen** — add an
   optional heart/star toggle to `common/Product/Product.tsx` (rendered as
   an absolutely-positioned `Pressable` overlay on the existing card, not a
   new card variant) and a matching toggle next to "Add to Cart" in
   `business/ProductDetailScreen/ProductDetailScreen.tsx`. Both read/write
   `useWishlistStore` directly, same as `ProductDetailScreen.tsx` already
   does with `useCartStore` — no new props need to thread through
   `ProductListScreen.tsx`.

3. **Wishlist screen** — add
   `components-library/src/business/WishlistScreen/WishlistScreen.tsx`,
   structurally close to `CartScreen.tsx` (list of saved products, remove
   action, an "Add to Cart" action per row that calls `useCartStore`'s
   `addItem`), with an empty state ("Your wishlist is empty.").

4. **Per-app routes** — add thin wrapper pages mirroring the existing
   cart/marketplace pages:
   - `web-application/app/wishlist/page.tsx` (mirrors
     `web-application/app/marketplace/page.tsx`'s wrapper style)
   - `mobile-application/src/app/(tabs)/wishlist/index.tsx` and
     `_layout.tsx` (mirrors the `(tabs)/cart` and `(tabs)/marketplace`
     directories)

5. **Navigation entry** — add a wishlist item to the shared nav
   configuration consumed by `common/MainNav/MainNav.tsx` /
   `common/BottomNav/BottomNav.tsx`, with `badgeCount` wired to the
   wishlist item count the same way the cart nav item presumably wires
   `getCartTotalCount` from `useCartStore.ts` today.

No changes to `ProductData` (`components-library/src/types/Product.ts`) or
the API layer are needed — the wishlist, like the cart, is client-side
state keyed by product id, not a server-persisted resource.

## Key files/areas

- New: `components-library/src/business/WishlistScreen/useWishlistStore.ts`
- New: `components-library/src/business/WishlistScreen/WishlistScreen.tsx`
  (+ `.stories.tsx`, `.web.test.tsx` following the pattern of
  `CartScreen.stories.tsx` / `CartScreen.web.test.tsx`)
- Edit: `components-library/src/common/Product/Product.tsx` (add toggle)
- Edit: `components-library/src/business/ProductDetailScreen/ProductDetailScreen.tsx`
  (add toggle)
- Edit: nav item config feeding `common/MainNav/MainNav.tsx` /
  `common/BottomNav/BottomNav.tsx`
- New: `web-application/app/wishlist/page.tsx`
- New: `mobile-application/src/app/(tabs)/wishlist/index.tsx`,
  `_layout.tsx`

## Verification

- Unit tests for `useWishlistStore.ts` mirroring `useCartStore.test.ts`
  (toggle add/remove, persistence round-trip).
- `WishlistScreen.web.test.tsx` mirroring `CartScreen.web.test.tsx` (empty
  state, list rendering, remove, add-to-cart handoff).
- `Product.web.test.tsx` extended to cover the new toggle's pressed/unpressed
  states and that it doesn't trigger `onPress` (card navigation).
- Manual pass on both apps: mark a product wishlisted from the list and
  from the detail screen, confirm it persists across a web reload and
  appears/disappears correctly in the wishlist screen on both platforms,
  confirm the nav badge count updates.
