# Server-validated coupon / discount codes at checkout

## Problem / opportunity

There is no notion of a promotion anywhere in this codebase — no `Coupon`
model in `api-rs/prisma/schema.prisma`, no discount field on `ProductData`,
and `CheckoutScreen.tsx`
(`components-library/src/business/CheckoutScreen/CheckoutScreen.tsx`)
computes the total with a single, unconditional
`getCartTotalPrice(items)` call. Coupon/discount codes are one of the
highest-leverage, most standard levers a real e-commerce product uses to
drive conversion and revenue: they unblock cart abandonment ("give me 10%
and I'll finish checking out"), power marketing campaigns (email blasts,
influencer codes, first-order incentives), and let the business run
time-boxed promotions without a deploy. Critically, a discount can't be a
client-side-only computation — if the percentage/amount lived only in
`components-library` code, anyone could read the bundle, forge a bigger
discount, and check out at whatever price they want. It has to be resolved
and validated server-side against a real record (does this code exist, is
it still active, has it expired, has it hit its redemption cap) and the
authoritative discounted total returned from the API, the same trust
boundary reason real checkouts never compute tax/discounts purely in the
frontend.

This is a different gap from every other proposal in this folder:
search/sort/wishlist/recently-viewed are about *browsing/discovery*,
ratings-and-reviews is a *trust/quality* signal, order-history and the
shipping-details-form proposal are about *what happens after* "Place
Order" is pressed (persisting the order, collecting shipping info) — none
of them touch *pricing* or promotions at all. This proposal is scoped
strictly to validating a code and computing a discounted total; it
deliberately does not depend on the (currently unimplemented)
order-history proposal's `Order` model — a coupon's "redemption count"
increments on `POST /coupons/redeem` independent of whether an `Order` row
exists yet, keeping this proposal self-contained. If order history lands
later, `POST /orders` can accept an already-validated `couponCode` and
store the resulting discount on the order; that wiring is out of scope
here.

## Proposed approach

### Database

Add a `Coupon` model to `api-rs/prisma/schema.prisma`:

```
model Coupon {
  id            String   @id @default(cuid())
  code          String   @unique
  discountType  String   // "PERCENT" | "FIXED"
  discountValue Float    // 10 = 10% for PERCENT, or 10.00 currency units for FIXED
  minOrderValue Float?   // e.g. code only applies to carts >= this subtotal
  maxRedemptions Int?    // null = unlimited
  redemptions   Int      @default(0)
  active        Boolean  @default(true)
  expiresAt     DateTime?
  createdAt     DateTime @default(now())
}
```

Generate a migration (`pnpm --filter @rnw/api-rs db:migrate`), and seed 2-3
realistic codes in `api-rs/prisma/seed.ts` (e.g. a 10%-off code, a $5-off
code with a `minOrderValue`, and one `active: false` / expired code to
exercise the failure paths).

### API

New `api-rs/src/handlers/coupons.rs` plus `api-rs/src/store/coupons.rs`,
mirroring how `products` is split today:

- `POST /coupons/validate` — body `{ code: string, subtotal: number }`.
  Looks up the code (case-insensitive), checks `active`, `expiresAt`,
  `maxRedemptions` vs `redemptions`, and `minOrderValue` vs `subtotal`.
  Returns `{ valid: true, code, discountType, discountValue, discountAmount,
  newTotal }` on success (computing `discountAmount`/`newTotal`
  server-side so the client never does the money math), or a 4xx with a
  clear reason (`"expired"`, `"not_found"`, `"redemption_limit_reached"`,
  `"below_minimum_order_value"`) on failure — no redemption-count mutation
  on validate, since a shopper may validate a code, then abandon.
- `POST /coupons/redeem` — body `{ code: string }`. Atomically increments
  `redemptions` (a single `UPDATE ... WHERE redemptions < maxRedemptions OR
  maxRedemptions IS NULL` guarded statement, or re-validate inside a
  transaction) and returns the updated coupon. Called by the client
  immediately after "Place Order" succeeds, so a validated-but-abandoned cart
  never consumes a redemption.
- Register the routes in `api-rs/src/app.rs`.

Both routes are `POST`s, so they need `Cache-Control: no-store` — api-rs's
blanket `EDGE_CACHE_CONTROL` is meant for the read paths only.

### Web

- Add `validateCoupon`/`redeemCoupon` functions to `web-application/lib/api.ts`,
  following the existing `fetchProducts`/`fetchProduct` `request<T>` shape.
- `web-application/app/checkout/page.tsx` (or wherever `CheckoutScreen` is
  currently mounted) passes `onValidateCoupon`/`onRedeemCoupon` props
  through.

### Mobile

- Add the same two functions to `mobile-application/src/api/client.ts`.
- Mobile's checkout route wrapper passes the same two props through.

### Shared (components-library)

- Extend `CheckoutScreenProps` in `CheckoutScreen.tsx` with
  `onValidateCoupon?: (code: string, subtotal: number) => Promise<CouponValidationResult>`
  and `onRedeemCoupon?: (code: string) => Promise<void>`.
- Add a small coupon input row above the total (text input + "Apply"
  button), local component state for the entered code, the applied
  discount, and an inline error message (e.g. "This code has expired").
  On "Apply", call `onValidateCoupon`; on success, replace the plain
  `Total: {formatPrice(getCartTotalPrice(items))}` line with a subtotal
  line, a discount line (e.g. `"Coupon SAVE10: -$4.20"`), and the
  discounted total.
- `placeOrder()` calls `onRedeemCoupon?.(appliedCode)` (fire-and-forget is
  fine — a failed redemption call shouldn't block the "Order placed!"
  confirmation, since the order itself already succeeded from the
  shopper's perspective) after the existing `clear()`.
- Add the `CouponValidationResult` type (mirroring `ProductData`'s home in
  `components-library/src/types/`) to `components-library/src/types/Coupon.ts`,
  imported by both `CheckoutScreen.tsx` and the per-app API clients so the
  shape only lives in one place.

## Key files/areas

- Edit: `api-rs/prisma/schema.prisma` (`Coupon` model) + migration under
  `api-rs/prisma/migrations/`
- Edit: `api-rs/prisma/seed.ts` (seed sample coupons)
- New: `api-rs/src/handlers/coupons.rs`, `api-rs/src/store/coupons.rs`
- Edit: `api-rs/src/app.rs` (register the coupon routes)
- New: `components-library/src/types/Coupon.ts`
- Edit: `components-library/src/business/CheckoutScreen/CheckoutScreen.tsx`
  (coupon input, discount line, `onValidateCoupon`/`onRedeemCoupon` props)
  + `CheckoutScreen.stories.tsx`, `CheckoutScreen.web.test.tsx`
- Edit: `web-application/lib/api.ts`, `web-application/app/checkout/page.tsx`
  (or current checkout route file)
- Edit: `mobile-application/src/api/client.ts`, mobile's checkout route
  wrapper

## Verification

- API: Rust unit tests for the coupons handler/store plus a hermetic E2E
  case in `api-rs/tests/`, covering valid-code discount math (both `PERCENT`
  and `FIXED`), expired code, inactive code, below-minimum-order-value,
  redemption-limit-reached, and that `POST /coupons/redeem` correctly
  increments `redemptions` and refuses once the cap is hit (including a
  concurrent-redemption case if the guard is transaction-based).
- `CheckoutScreen.web.test.tsx` extended: applying a valid code updates the
  displayed total and shows the discount line; an invalid/expired code
  shows the inline error and leaves the total unchanged; `onRedeemCoupon`
  fires with the applied code when "Place Order" is pressed.
- Manual end-to-end: seed the three sample coupons, add items to cart,
  enter the expired code at checkout (confirm the error message and
  unchanged total), enter the valid percent-off code (confirm discount and
  new total), place the order (confirm "Order placed!" still shows), then
  re-validate the same code and confirm the API now reflects one fewer
  available redemption if `maxRedemptions` was set; repeat the apply +
  place-order flow on mobile to confirm parity.
