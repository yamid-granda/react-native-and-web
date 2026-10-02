# Order history

## Problem / opportunity

`CheckoutScreen.tsx` (`components-library/src/business/CheckoutScreen/CheckoutScreen.tsx`)
is currently a stub: "Place Order" just reads the cart total, stores it in
local component state (`placedTotal`), and clears `useCartStore`. Nothing
is sent to the API — there is no `Order` model in
`api-rs/prisma/schema.prisma`, no `POST /orders` endpoint, and no order id is
ever generated. Once a shopper leaves the "Order placed!" screen, every
trace of that purchase is gone; there is no way to see what was bought,
when, or for how much. This is distinct from the five other proposals in
this folder, which are all about *browsing/discovery* (search, sort,
wishlist, recently-viewed) or *product-level* signals (ratings, stock) —
none of them touch checkout or add any server-persisted record of a
purchase. Order history is a baseline e-commerce expectation and the most
direct fix for checkout's biggest current gap: a placed order that leaves
no trace.

The app has no auth/user model at all (`schema.prisma` has no `User`), so
this proposal deliberately does **not** introduce one. Instead it mirrors
the pattern already established for the cart: an unauthenticated,
device-local list of "orders I placed," persisted the same way
`useCartStore.ts` persists cart contents, with the actual order records
living server-side keyed by generated order ids that the device
remembers.

## Proposed approach

Shared logic in `components-library`, thin routing/data-fetching wrappers
in `web-application`/`mobile-application`, matching this repo's existing
pattern for `ProductListScreen`/`CartScreen`/`CheckoutScreen`:

1. **API — persist the order.** Add an `Order`/`OrderItem` Prisma model to
   `api-rs/prisma/schema.prisma` (`Order { id, createdAt, totalPrice,
   currency }`, `OrderItem { id, orderId, productId, title, unitPrice,
   quantity }` — snapshot `title`/`unitPrice` on the item rather than just
   a `Product` relation, so a later price or title change doesn't rewrite
   history), then migrate with `pnpm --filter @rnw/api-rs db:migrate`. Add an
   `api-rs/src/handlers/orders.rs` plus `api-rs/src/store/orders.rs`
   (mirroring how `products` is split today) exposing `POST /orders` (body:
   cart line items, returns the created order with its id) and
   `GET /orders?ids=id1,id2` (returns the matching orders, newest first) — no
   auth, no user scoping, since the device already knows which order ids are
   "its own."

   As with the reviews proposal, this is api-rs's first write path: `POST`
   needs its own `Cache-Control` (never cacheable), and the response must not
   be stored under the shared L1/L2 tiers the read routes use.

2. **Web/mobile API clients** — add `createOrder` and `fetchOrders`
   functions to `web-application/lib/api.ts` and
   `mobile-application/src/api/client.ts`, following the existing
   `fetchProducts`/`fetchProduct` shape (thin `request<T>` wrappers).

3. **Shared order-history store** — add
   `components-library/src/business/CheckoutScreen/useOrderHistoryStore.ts`,
   a small zustand store holding just `placedOrderIds: string[]` with an
   `addOrderId` action, persisted with the exact same `localStorage` /
   in-memory-fallback split `useCartStore.ts` already uses (same
   rationale: web nav is a full page reload, native isn't).

4. **Wire `CheckoutScreen`** — change its `placeOrder` (currently pure
   local state in `CheckoutScreen.tsx`) to call an injected
   `onPlaceOrder: (items) => Promise<{ id: string }>` prop (thin wrappers
   pass `createOrder`), then call `useOrderHistoryStore`'s `addOrderId`
   with the returned id before clearing the cart. Show the returned order
   id on the existing "Order placed!" confirmation state, plus a "View
   Order History" link.

5. **Order history screen** — add
   `components-library/src/business/OrderHistoryScreen/OrderHistoryScreen.tsx`,
   structurally close to `CartScreen.tsx`/`CheckoutScreen.tsx`: takes
   `orders`/`isLoading`/`error` props, renders each order's date, id,
   line items, and total; empty state ("You haven't placed any orders
   yet.").

6. **Per-app wrappers** — add
   `web-application/app/orders/page.tsx` and
   `mobile-application/src/app/(tabs)/orders/index.tsx` (+ `_layout.tsx`),
   mirroring the `marketplace`/`cart` wrapper pattern: read
   `placedOrderIds` from `useOrderHistoryStore`, fetch them via
   `fetchOrders`, pass the result into `OrderHistoryScreen`.

7. **Navigation entry** — add an "Orders" item to the nav config consumed
   by `common/MainNav/MainNav.tsx` / `common/BottomNav/BottomNav.tsx`,
   same mechanism as the existing cart nav item.

## Key files/areas

- Edit: `api-rs/prisma/schema.prisma` (`Order`, `OrderItem` models) + a
  migration under `api-rs/prisma/migrations/`
- New: `api-rs/src/handlers/orders.rs`, `api-rs/src/store/orders.rs`
- Edit: `api-rs/src/app.rs` (register the `/orders` routes)
- Edit: `web-application/lib/api.ts`, `mobile-application/src/api/client.ts`
  (`createOrder`, `fetchOrders`)
- New: `components-library/src/business/CheckoutScreen/useOrderHistoryStore.ts`
- Edit: `components-library/src/business/CheckoutScreen/CheckoutScreen.tsx`
  (`onPlaceOrder` prop, show order id, "View Order History" link)
- New: `components-library/src/business/OrderHistoryScreen/OrderHistoryScreen.tsx`
  (+ `.stories.tsx`, `.web.test.tsx` following `CartScreen`'s pattern)
- Edit: nav item config feeding `common/MainNav/MainNav.tsx` /
  `common/BottomNav/BottomNav.tsx`
- New: `web-application/app/orders/page.tsx`
- New: `mobile-application/src/app/(tabs)/orders/index.tsx`, `_layout.tsx`

## Verification

- Rust unit tests for the orders handler/store covering order creation
  (line-item snapshotting, total computation) and lookup by ids, plus a
  hermetic E2E case in `api-rs/tests/` mirroring the products coverage.
- Unit tests for `useOrderHistoryStore.ts` (add id, persistence
  round-trip) mirroring `useCartStore.test.ts`.
- `CheckoutScreen.web.test.tsx` extended to cover `onPlaceOrder` being
  called with the cart's line items and the returned order id rendering
  on the confirmation state.
- `OrderHistoryScreen.web.test.tsx` covering empty state, list rendering,
  and error state, mirroring `CartScreen.web.test.tsx`.
- Manual pass on both apps: add items to cart, place an order, confirm
  the order id shows on the confirmation screen, navigate to Order
  History and confirm the order appears with correct items/total, reload
  the web app and confirm the order is still listed (mobile: background
  and resume the app).
