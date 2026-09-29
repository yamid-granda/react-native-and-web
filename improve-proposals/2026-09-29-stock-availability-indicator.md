# Stock / availability indicators for marketplace products

## Problem / opportunity

`ProductData` (`components-library/src/types/Product.ts`) and the
`Product` model backing it (`api/prisma/schema.prisma`, lines 14-23) carry
no notion of stock at all — `id`, `title`, `description`, `price`,
`currency`, `imageUrl`, `createdAt`, nothing else. A shopper can add any
product to the cart and walk through `CheckoutScreen.tsx` regardless of
whether it's actually available, and there's no signal anywhere in the UI
(`Product.tsx` card, `ProductDetailScreen.tsx`) that a product might be
low or out of stock. This is a real, common e-commerce gap distinct from
the three other proposals in this folder (recently-viewed is about
navigation history, sort/price-filter is about narrowing the list,
wishlist is about saving items for later) — none of them touch product
availability at all.

## Proposed approach

Add `stock` as a first-class field that flows from the DB through the API
into `ProductData`, then surface it in the two shared screens that already
render product info — no new screens needed, no changes to the per-app
route wrappers.

1. **Schema + migration** — add `stock Int @default(0)` to the `Product`
   model in `api/prisma/schema.prisma`, generate a migration, and update
   `api/prisma/seed.ts` to seed a realistic mix of values (some `0` /
   out-of-stock, some low like `1`-`3`, most healthy stock) so the new UI
   states are exercisable locally without hand-editing the DB.

2. **API passthrough** — `ProductsService.findAll`/`findOne`
   (`api/src/products/products.service.ts`) return raw Prisma rows with no
   DTO mapping layer, so `stock` requires no controller/service code
   change — it appears in the response automatically once it's a column.
   Update `products.service.spec.ts`/`products.controller.spec.ts` fixtures
   to include `stock` so they keep matching the real shape.

3. **Shared type** — add `stock: number` to `ProductData`
   (`components-library/src/types/Product.ts`).

4. **Product card badge** — in `common/Product/Product.tsx`, render a
   small "Out of stock" badge over the image when `stock === 0` (styled
   like a status pill, not a new card variant), and lower the card's
   opacity slightly so out-of-stock items read as unavailable at a glance
   while scrolling the grid/list.

5. **Detail screen + add-to-cart gating** — in
   `business/ProductDetailScreen/ProductDetailScreen.tsx`:
   - Show "In stock" / "Only N left" (e.g. when `stock <= 5`) / "Out of
     stock" text near the price.
   - Disable the "Add to Cart" button and relabel it ("Out of stock")
     when `stock === 0`.
   - When `stock > 0`, no other behavior change — the existing
     `useCartStore.addItem` call stays as-is. Clamping cart quantity to
     available stock is a natural follow-up but is left out of this
     proposal's scope to keep it to one concrete change; `CartScreen.tsx`
     already has working increment/decrement controls that this doesn't
     need to touch.

## Key files/areas

- Edit: `api/prisma/schema.prisma` (new `stock` column) + generated
  migration under `api/prisma/migrations/`
- Edit: `api/prisma/seed.ts` (seed varied stock values)
- Edit: `api/src/products/products.service.spec.ts`,
  `api/src/products/products.controller.spec.ts` (fixtures include `stock`)
- Edit: `components-library/src/types/Product.ts`
- Edit: `components-library/src/common/Product/Product.tsx` (+ its
  `.stories.tsx`/`.web.test.tsx`)
- Edit: `components-library/src/business/ProductDetailScreen/ProductDetailScreen.tsx`
  (+ `ProductDetailScreen.web.test.tsx`)
- No changes needed to `web-application/app/marketplace/*`,
  `mobile-application/src/app/(tabs)/marketplace/*`, `CartScreen.tsx`,
  `CheckoutScreen.tsx`, or `useCartStore.ts`.

## Verification

- API: unit tests for `ProductsService` confirming `stock` round-trips
  through `findAll`/`findOne`; a migration smoke test (apply + seed
  locally) confirming the new column has a sane default for any
  pre-existing rows.
- `Product.web.test.tsx` extended: the out-of-stock badge renders only
  when `stock === 0`, not for low or healthy stock.
- `ProductDetailScreen.web.test.tsx` extended: "Add to Cart" is disabled
  and relabeled at `stock === 0`, shows "Only N left" at low stock, and
  behaves exactly as today at healthy stock.
- Manual pass on both apps: seed one out-of-stock and one low-stock
  product, confirm the list badge and detail-screen messaging/button state
  match on web and native, and confirm a healthy-stock product's add-to-cart
  flow is unaffected.
