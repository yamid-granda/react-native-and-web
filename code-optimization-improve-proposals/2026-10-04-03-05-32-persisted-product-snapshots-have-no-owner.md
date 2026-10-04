# The three persisted stores keep a product snapshot, and nothing can tell it from a live one

## Problem / opportunity

`components-library` has **four** client-side caches of product data. One is
managed and has an owner. Three are raw `ProductData` snapshots written to
`localStorage` with no TTL, no version, and no path to ever be corrected — and
every price, stock badge and order total the shopper sees is computed from one
of them.

The managed one: react-query, `staleTime: 5 * 60 * 1000`
(`web-application/app/providers.tsx:12-14`,
`mobile-application/src/query/queryClient.ts:6-8`), invalidated on write.

The three unmanaged ones are zustand + `persist`:

| store | shape | storage key | owner |
| --- | --- | --- | --- |
| `useCartStore` | `Record<string, { product: ProductData, quantity }>` (`useCartStore.ts:6-9`, `:12`) | `cart-storage` (`:66`) | none |
| `useWishlistStore` | `Record<string, ProductData>` (`useWishlistStore.ts:7`) | `wishlist-storage` (`:32`) | none |
| `useRecentlyViewedStore` | `ProductData[]` (`useRecentlyViewedStore.ts:9`) | `recently-viewed-storage` (`:26`) | none |

The root cause is one type-level decision, made once and inherited three times:
**the persisted unit is a `ProductData`, not a product id.** Every consumer
therefore has nothing to revalidate *against*.

### 1. There is no seam to revalidate against, and `ProductData` cannot carry one

`grep -rn 'useQuery' components-library/src` returns exactly one hit outside the
hooks directory listing: `business/StoreScreen/useMyStoreProducts.ts:45`. **No
screen in the library fetches a product for the cart, the wishlist or the
recently-viewed rail.** And `ProductData` (`types/Product.ts:1-22`) has no
version, `updatedAt` or ETag field, so a stale snapshot cannot even be
*identified* as stale, let alone refreshed. Both halves would have to be built.

The three app routes confirm it — none of them fetches anything:

```tsx
// web-application/app/cart/page.tsx:9
return <CartScreen onCheckout={() => router.push("/checkout")} />
// web-application/app/wishlist/page.tsx:6
return <WishlistScreen />
// web-application/app/checkout/page.tsx:10-13  — navigation callbacks only
```

`CartScreen`, `WishlistScreen` and `CheckoutScreen` take no data props. Their
data *is* the persisted store, permanently.

### 2. The live symptom: ten permanently-stale cards sit above the live catalog

This is the part no offline argument covers. `web-application/app/marketplace/page.tsx:9-10`
fetches the marketplace through `useInfiniteProducts`, and
`ProductListScreen` renders the recently-viewed rail **inside the same screen**,
directly above the grid:

```tsx
// components-library/src/business/ProductListScreen/ProductListScreen.tsx:75-76, 129-147
const recentlyViewed = useRecentlyViewedStore((state) => state.items)
const showRecentlyViewed = recentlyViewed.length > 0 && !query.trim()
…
{recentlyViewed.map((product) => (
  <Product key={product.id} {...product} onPress={() => onSelectProduct?.(product.id)} … />
))}
```

…and identically at `ProductListScreen.web.tsx:37-38` and `:80-95`.

`Product` renders the price (`Product.tsx:83`) and an out-of-stock badge from
`product.stock` (`Product.tsx:33`, `:63-67`, `:70-74`). So the marketplace screen
displays, in one viewport, a react-query-fetched catalog and up to ten cards
whose prices and stock levels were captured the first time the shopper opened
each product. A shopper who viewed ten items last month sees last month's prices
above this month's list. Nothing expires them: `MAX_ITEMS = 10`
(`useRecentlyViewedStore.ts:6`) bounds the *count*, not the *age*.

The only thing that ever refreshes a snapshot is re-opening that product's detail
page (`ProductDetailScreen.tsx:54-56`, keyed on `product?.id`). Wishlist and cart
have no such path at all.

### 3. The order total is client-computed from that snapshot, and the repo has already ruled this out for discounts

`getCartTotalPrice` is the single reducer, and it reads the stored price:

```ts
// components-library/src/business/CartScreen/useCartStore.ts:74-76
export function getCartTotalPrice(items: Record<string, CartItem>) {
  return Object.values(items).reduce((total, item) => total + item.product.price * item.quantity, 0)
}
```

It has four call sites, and between them they render every money figure on the
cart and checkout screens:

- `CartScreen.tsx:50` — unit price; `:84` — `Total:`
- `CheckoutScreen.tsx:79` — `{quantity} × {formatPrice(product.price, …)}`
- `CheckoutScreen.tsx:83` — line total
- `CheckoutScreen.tsx:89` — order total
- `CheckoutScreen.tsx:33` → `:47` — the figure rendered as **"Order placed!"**

`CheckoutScreen.placeOrder()` (`CheckoutScreen.tsx:31-35`) sends nothing to any
server, so today no money moves and this is latent rather than a live
mischarge. It is still the wrong shape, and the repo has already written the
ruling down — for the *discount*, one layer above:

> `improve-proposals/2026-09-29-15-22-coupon-discount-codes.md:15-18`
> "a discount can't be a client-side-only computation — if the percentage/amount
> lived only in `components-library` code, anyone could read the bundle, forge a
> bigger discount, and check out at whatever price they want. It has to be
> resolved and validated server-side against a real record … and the
> authoritative discounted total returned from the API"

That proposal returns a server-computed `newTotal`. The client it will be
compared against is `getCartTotalPrice` over an arbitrarily old snapshot. The
queued work cannot be built correctly until the subtotal is either re-read or
server-owned.

The live, non-latent harm today is the *display*: a seller raises a price
(`PATCH /my-store/products/{id}` exists and is exercised by
`web-application/e2e/my-store.spec.ts:68-75`), and the shopper's cart, checkout
and wishlist keep showing the old figure with no mechanism to ever update it.

### 4. Staleness propagates from one store into another

```tsx
// components-library/src/business/WishlistScreen/WishlistScreen.tsx:48-53
<Button label="Add to Cart" … onPress={() => addItem(product)} />
```

`product` here is the wishlist's snapshot, not the live product. Wishlisting from
a card copies that snapshot into the cart
(`Product.tsx:90` / `Product.web.tsx:83`), so a product wishlisted at $10 weeks
ago lands in the cart at $10 even if it is now $500 or deleted. That is a
plain data-flow bug, not a caching trade-off.

### 5. A seventh hand-written `ProductData` literal, and it has already drifted

Because the snapshot's type is a wide interface with optional fields rather than
something with one constructor, every producer hand-builds it. Two of them are
byte-identical to each other and **silently drop the seller**:

```tsx
// components-library/src/common/Product/Product.tsx:90
// components-library/src/common/Product/Product.web.tsx:83
onPress={() => toggleItem({ id, title, description, price, currency, imageUrl, stock })}
```

`storeId` and `storeName` are absent from that literal, and `ProductData`
declares them optional (`types/Product.ts:20-21`), so TypeScript cannot complain.
The result: wishlisting from any product card — five render sites, both
platforms — persists a product with **no seller**, while
`ProductDetailScreen.tsx:124` wishlists the whole object and keeps it. Two paths,
two different persisted shapes, no failure. `ownerId`'s absence is a deliberate
decision (`types/Product.ts:15-19`); `storeId`'s accidental absence here is not.

### 6. The three stores have no test that could have caught any of this

`useCartStore.test.ts`, `useWishlistStore.test.ts` and
`useRecentlyViewedStore.test.ts` run in the node-only `utils` Vitest project
(`vitest.config.utils.ts:8-10`) and assert the reducer against
`persistStorage.ts`'s in-memory branch — `useRecentlyViewedStore.test.ts:12-37`
checks ordering, de-duplication and the cap. All correct, and none of them can
express "the price changed on the server", because the store has no notion of a
server. The screen tests (`CartScreen.web.test.tsx`, `CheckoutScreen.web.test.tsx`,
`WishlistScreen.web.test.tsx`) each control the same fixture that feeds the
store, so they cannot see a divergence either.

### How the decision was reached, and why nobody revisited it

`improve-proposals/implemented/2026-09-29-recently-viewed-products.md:21` says it
mirrors "the cart/wishlist pattern already established in this repo". So the
third store inherited the decision rather than making it. The seller proposal
then listed all three under **"No changes"**
(`improve-proposals/2026-10-03-seller-storefronts-my-store.md:269`) — correctly,
as feature scope, and without examining the shape. Three implementations of one
unexamined decision, and the type system cannot see it because every field is
optional.

## Proposed approach

Keep all three stores, their storage keys, and `persistStorage.ts` exactly as
they are. Change one thing: **the persisted unit becomes a product id plus the
minimum the screen needs, and re-reading a product becomes a shared seam.** Two
landable steps, in this order.

### 1. One seam for "give me these products, live or absent"

New `components-library/src/business/ProductLookup/useProductLookup.ts`:

```ts
/**
 * Resolve product ids to live products, in one batched query.
 *
 * The persisted stores keep ids, not snapshots: a stored price is a price
 * nobody has checked since the day it was written. Everything that renders a
 * remembered product — cart, wishlist, recently-viewed — resolves through here,
 * so one query serves a whole list and the screens stop needing a fetch prop.
 *
 * Ids the server no longer returns come back as `missing`, which is how a
 * deleted product leaves a cart instead of being totalled forever.
 */
export function useProductLookup(ids: string[]) {
  const query = useQuery({
    queryKey: productLookupKey(ids),          // sorted, so order does not fragment
    queryFn: (ctx) => fetchProductsByIds(ids, ctx.signal),
    enabled: ids.length > 0,
    staleTime: 0,                             // deliberately not the 5-minute default
  })
  …
  return { byId, missing, isLoading }
}
```

Three decisions a reviewer should make explicitly, not by accident:

- **`staleTime: 0`.** The five-minute default
  (`web-application/app/providers.tsx:13`) is right for a catalog and wrong for
  a cart: the whole point is to notice that a remembered price moved. Say so in
  the doc comment rather than leaving it to be discovered.
- **Batched, not N queries.** The API has no `GET /products?ids=` — see the
  trade-offs — so this needs either one new endpoint or `queryClient.fetchQuery`
  per id with `Promise.all`. Prefer the endpoint; see Risks.
- **`missing` is a first-class result, not an error.** It is what lets
  `CartScreen` drop a deleted line, which today it cannot.

### 2. Narrow the three persisted shapes to identity + the fields a screen cannot re-read cheaply

```ts
// useCartStore.ts — the only change is the stored shape
export type CartItem = { id: string; quantity: number }
type CartState = { items: Record<string, CartItem>; … }

// useWishlistStore.ts
type WishlistState = { ids: string[]; toggle: (product: ProductData) => void; remove: (id: string) => void }

// useRecentlyViewedStore.ts — already ordered and de-duplicated by id
type RecentlyViewedState = { ids: string[]; recordView: (product: ProductData) => void }
```

`toggle`/`recordView` still take the live `ProductData` they are handed and keep
only its `id`, which removes `Product.tsx:90`'s and `Product.web.tsx:83`'s
hand-built literal entirely — finding 5 closes as a side effect, because the
callee now needs one field and cannot be handed a wrong one.

The three screens then resolve through `useProductLookup` instead of reading
`state.items` as products:

- `WishlistScreen.tsx:20-25` — `ids` → `useProductLookup(ids)` → render `byId`,
  drop `missing` into the existing empty-state copy at `:32`.
- `CartScreen.tsx:26` / `CheckoutScreen.tsx:29` — same, and **the total moves
  out of the store**. `getCartTotalPrice` (`useCartStore.ts:74-76`) currently
  takes `Record<string, CartItem>`; it should take the resolved
  `ProductData[]`, so there is exactly one place that multiplies a price and it
  is downstream of the lookup. This is the change that makes finding 3
  structurally impossible rather than merely discouraged.
- `ProductListScreen.tsx:75-76` and `.web.tsx:37-38` — the rail resolves ids
  the same way, so the ten cards above the grid are as fresh as the grid.

`ProductDetailScreen.tsx:48, 54-56` and `:111` are unchanged: they already hold
the live product and only pass its id along now.

### 3. `ProductData` gains the one field that makes staleness detectable

Not for the caches — for the *server*. `ProductJson` already carries
`createdAt`; a seller edit moves nothing on the wire today, so a client cannot
even tell "I have seen this product" from "this product has changed".

Only add it if step 1 lands: with `useProductLookup` there is nothing to compare
it against, and an unused version field is the kind of thing that outlives its
proposal. Flagging it so the decision is made on purpose.

### What this deliberately does not do

- **No offline mode.** There is no network-failure story in this app today and
  this does not invent one. If a shopper is offline, the cart shows what it last
  resolved and that is stated in the doc comment, not hidden.
- **No server-authoritative total yet.** That is
  `improve-proposals/2026-09-29-order-history.md`'s and the coupon proposal's
  job. This only makes the client subtotal *true*, so their arithmetic has
  something correct to apply.
- **`Product.tsx`'s platform split stays split.** Untouched here.

## Impact

**Consistency.** Three caches with unbounded, ownerless staleness become three
caches with one stated policy (`staleTime: 0`, batched, `missing` is a result).
The `getCartTotalPrice`-over-a-snapshot shape stops existing, so "what does the
shopper pay" has one answer computed from live data.

**Correctness — the reason this is worth doing.** The marketplace screen stops
displaying last month's prices above this month's catalog. A cart stops totalling
a price the seller has already changed. `WishlistScreen.tsx:52` stops copying a
stale snapshot into the cart. `Product.tsx:90` stops dropping `storeId`, so
wishlisting from a card and wishlisting from the detail page persist the same
thing.

**Testability.** This is the structural gain. `useProductLookup` is a
`renderHook` seam in the Vitest project that already runs
(`vitest.config.web.ts:44` globs `src/**/*.web.test.tsx`), modelled on
`useInfiniteProducts.web.test.tsx`. For the first time a test can say "the server
price changed, the cart total changed with it" — today no test in the repo can
express that, because no component re-reads anything. `useProductLookup` is also
the first thing in the library that both list screens, the cart, the checkout
and the wishlist share, so its behaviour is asserted once.

**Reuse.** One lookup replaces the DTO plumbing at four render sites across
five files; three hand-maintained snapshots become three id lists; two
hand-written `ProductData` literals disappear.

**Performance.** One batched query per screen mount, where today there are
zero. That is a real cost and it is the honest price of correctness: opening
the cart goes from 0 to 1 request. It is bounded — one request per screen, not
per line item — and it replaces N localStorage reads of unbounded age. With the
existing per-IP limiter at 100 rps (`load-tests/README.md:62`) and a five-minute
catalog `staleTime`, this does not move any SLO; but the endpoint should be
measured rather than assumed, which is why it is in Validation.

**What does not improve.** react-query still caches the catalog for five minutes
after a seller write, on both platforms — that is
`code-optimization-improve-proposals/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`'s
finding 3 and is untouched here; this proposal makes the *cart* immune to it,
not the list. `mobile-application` still has no unit test runner, so the mobile
half of every assertion is `tsc` plus Detox only. The recently-viewed rail's
de-duplication and cap move from "tested against a fixture" to "tested against a
query", which is better but is not the same as testing the ordering logic
itself — keep `useRecentlyViewedStore.test.ts` for that. And nothing in
`api-rs`'s cache or store layer changes.

## Risks / trade-offs

- **This needs an endpoint that does not exist.** There is no
  `GET /products?ids=`. Three ways out, and the choice is the reviewer's:
  (a) add `GET /products/by-ids?ids=a,b,c` to api-rs, returning
  `{ items, missing }` — one round trip, honours the existing generation-folded
  cache, and is the smallest thing that makes the seam honest;
  (b) `queryClient.fetchQuery` per id with `Promise.all` — no api-rs change, but
  N requests for an N-item cart and a stampede risk that `cache/singleflight.rs`
  already exists to prevent;
  (c) reuse `GET /products/{id}` per id, accepting (b)'s cost. **Do not choose
  (b) or (c) silently** — the whole point is that one lookup is one query.
- **Dropping the snapshot changes what the cart survives.** Today the cart
  renders with no network at all. After this it needs one successful lookup to
  render line items. That is the intended trade, and it must be stated in
  `useCartStore`'s doc comment rather than discovered by a shopper on a flaky
  connection. If the team wants offline carts, that is a separate and larger
  decision (persist the snapshot *and* the id, and say which wins) and should be
  taken deliberately rather than inherited from today's accident.
- **`missing` needs copy.** A cart that silently drops a deleted line is worse
  than one that says so. `CartScreen.tsx`'s empty state (`:35`) and
  `CheckoutScreen.tsx`'s (`:57`) are the places, and
  `web-application/e2e/my-store.spec.ts:77-79` already asserts the
  delete-then-empty transition for My Store, so there is a precedent for the
  assertion to copy.
- **It contradicts an implemented proposal's stated approach**, in one line:
  `implemented/2026-09-29-recently-viewed-products.md:33-34` says
  "Expose `recordView(product: ProductData)` and a `items: ProductData[]`
  selector". This changes the selector to `ids: string[]`. The *record* side is
  unchanged. Say so in that document's commit message, and note that its own
  test file (`useRecentlyViewedStore.test.ts:12-37`) will need rewriting — which
  is the point, since it is currently asserting the shape being removed.
- **The lookup puts a `QueryClientProvider` requirement on four screens.**
  `CartScreen`/`CheckoutScreen`/`WishlistScreen` currently have no data props
  and no provider requirement, so their existing tests
  (`CartScreen.web.test.tsx`, `CheckoutScreen.web.test.tsx`,
  `WishlistScreen.web.test.tsx`) will need a wrapper. That is a real cost across
  three suites and should be done in one commit with the change, not after.
- **A shared lookup in `components-library` needs a fetch prop, which is the
  convention this repo already uses** — `StoreScreen.tsx:31-38` and
  `ProductFormScreen.tsx:41-51` both document "props in, no fetching inside".
  `useProductLookup` is a *hook*, not a screen, so it may take the fetcher the
  way `useInfiniteProducts` does (`useInfiniteProducts.ts` takes `fetchProducts`
  from the app route), and the screens thread it down as a prop. Getting this
  wrong puts `fetch` inside a shared screen, which
  `improve-proposals/2026-10-03-seller-storefronts-my-store.md:172` settled
  against. Read that line before writing the signature.
- **Scope.** The two api clients stay duplicated (settled at the same line). The
  `ProductListScreen` platform split stays split — it is a genuine
  `FlatList`-vs-grid difference, per
  `code-optimization-improve-proposals/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`.
  The 23 test files with inline product fixtures, the `node`-vs-jsdom project
  split for the store tests, and the absent native Vitest project are all real
  and all separate.

## Validation

1. `pnpm --filter @rnw/components-library test` — the three existing store
   suites will **fail** until `useRecentlyViewedStore.test.ts:12-37` and the
   `useCartStore`/`useWishlistStore` equivalents are rewritten against ids.
   That is expected and is the first thing to do, because the rewrite is what
   proves the shape changed. Everything else — the 31 `.web.test.tsx` files —
   must pass unchanged.
2. `pnpm --filter @rnw/components-library test` again after steps 1-2 of the
   approach, now with `useProductLookup.web.test.tsx`. Three assertions, each of
   which is unwritable today:
   - the cart total **changes** when the lookup returns a different price;
   - an id the server omits comes back in `missing` and the line is not totalled;
   - a failing lookup surfaces the existing `error` prop rather than rendering
     an empty cart as if it were genuinely empty.
3. **Negative check**, in a scratch branch: set the lookup's `staleTime` to the
   5-minute default and confirm assertion 1 fails. If it passes, the suite is
   not asserting the policy.
4. **Negative check for finding 5**, in a scratch branch: add a field to
   `ProductData` and confirm `Product.tsx:90` and `Product.web.tsx:83` no longer
   compile against a hand-built literal — i.e. that removing the literals
   actually made the drift impossible rather than merely relocated.
5. `pnpm --filter @rnw/web-application test` — 7 files. `checkout.test.tsx` and
   `cart.test.tsx` need a `QueryClientProvider` and a `fetchProductsByIds` mock;
   `marketplace.test.tsx` must pass **unchanged** and is the regression net for
   the rail (`app/marketplace/page.tsx` → `ProductListScreen.web.tsx:80-95`).
6. `pnpm typecheck && pnpm lint`. Three store state types change shape and four
   screens lose a `state.items` read, so this is the cheap check that no screen
   kept reading `items` as products.
7. `pnpm --filter @rnw/api-rs test` and `pnpm --filter @rnw/api-rs lint` — only
   if endpoint (a) is chosen. `pnpm --filter @rnw/api-rs test:e2e` (needs
   Docker) must then add the endpoint to `tests/parity.rs`'s goldens and prove a
   deleted id comes back in `missing`.
8. `pnpm --filter @rnw/web-application test:e2e` — `e2e/cart.spec.ts:5` and
   `e2e/checkout.spec.ts:5` assert on the rendered `Total: `, so they are the
   real check that the money figures still render. Extend `e2e/my-store.spec.ts`
   with the scenario this proposal is about: view a product, add it to the cart,
   **edit its price as the seller**, return to `/cart`, and assert the total
   moved. That test fails today and is the whole finding in one assertion.
   Needs api-rs running and seeded.
9. `pnpm --filter @rnw/mobile-application test:e2e` — **not runnable without
   Xcode and a simulator**, and said so plainly. `e2e/cart.e2e.ts` and
   `e2e/checkout.e2e.ts` are the only checks that reach the native
   `Product.tsx:90` path, and this is not done until they run green on a
   machine with a native build.
10. Mechanical check, the same shape as the evidence above:
    ```bash
    grep -rn 'ProductData' components-library/src/business/*/use*Store.ts
    grep -rn 'getCartTotalPrice' --include='*.tsx' --include='*.ts' .
    grep -rn 'toggleItem({' --include='*.tsx' .
    ```
    After: the first shows no `ProductData` in a persisted state type; the
    second's signature takes resolved products; the third returns nothing.

## Related proposals

- **`code-optimization-improve-proposals/2026-10-04-02-19-04-one-mutation-seam-for-every-seller-write.md`
  — related, not superseded, and the two are two halves of one bug.** Its
  finding 3 is that a seller write does not retire five react-query key families
  for up to five minutes. This proposal is that the cart, wishlist and
  recently-viewed rail are not in react-query at all, so **no** invalidation
  would ever reach them: `invalidateQueries` cannot touch a zustand store, and
  that proposal's `productWriteKeys` list has nothing to add them to. Its
  closing line — "the stale copy never leaves the browser" — describes the
  react-query case; this one is worse, because the stale copy is *persisted*.
  Do not land both independently: if its invalidation lands first this proposal
  still stands (the five-minute window becomes irrelevant for the cart only if
  the cart re-reads), and if this lands first its finding 3 becomes a
  marketplace-list-only problem.
- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — unrelated surface** (per-app route files). Its finding 3 notes
  `mobile-application` has no unit test runner, which is the reason step 9 above
  is Detox-only.
- **`code-optimization-improve-proposals/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`
  — related, and its step 1 touches a file this one also touches.**
  `Product.tsx:90` and `Product.web.tsx:83` are the two lines this proposal
  deletes outright (finding 5); that proposal splits those files into a shared
  `ProductCard` body plus two adapters and moves the literal into the body
  unchanged. **Order them, and note that if it lands first the literal is
  written once instead of twice** — this proposal's step 2 still removes it,
  and removes it from one file rather than two. Its `MainNav` and
  `ProductFilterControls` material is untouched here.
- **`improve-proposals/2026-09-29-15-22-coupon-discount-codes.md` — related, and
  the reason step 3 of the approach is bounded the way it is.** Lines 15-18
  already rule that money math is server-authoritative; this proposal does not
  reopen that and does not implement it. It makes the client's subtotal true so
  that proposal's server-computed `newTotal` has something correct to apply. Its
  `CouponValidationResult` and `CheckoutScreenProps` changes are additive to
  this and should be sequenced after it.
- **`improve-proposals/2026-09-29-order-history.md` — related, not superseded.**
  Line 47-49 already recognises this is api-rs's first write path and that the
  response must not sit in a shared cache. It says nothing about what the client
  holds, which is the half this proposal fixes: `POST /orders` will need a
  trustworthy subtotal, and `getCartTotalPrice` over a snapshot is not one.
- **`improve-proposals/implemented/2026-09-29-recently-viewed-products.md` —
  this proposal supersedes one line of it.** Its step 1 specifies
  `items: ProductData[]`; this changes that to `ids: string[]` and leaves the
  `recordView(product)` call site untouched. Its step 3 (render the rail above
  the grid, both platform copies) is kept exactly as specified — the rail is
  right, it is what it reads that has to change. Its other implemented siblings
  (`sort-and-price-filter`, `wishlist-favorites`, `stock-availability-indicator`)
  established the same three-store shape by the same "mirror the existing
  pattern" reasoning and are not otherwise touched.
- **`code-optimization-improve-proposals/2026-10-04-01-10-39-one-owner-for-the-web-resolution-contract.md`,
  `…-2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`'s sibling
  `…-2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`, and
  `…-2026-10-03-22-37-46-make-the-store-contract-executable.md` — unrelated
  surfaces** (bundler config, api-rs read path, api-rs store traits). None
  touches a persisted client store. No overlap.