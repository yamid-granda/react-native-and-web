# Shipping/contact details form at checkout

## Problem / opportunity

`CheckoutScreen.tsx`
(`components-library/src/business/CheckoutScreen/CheckoutScreen.tsx`)
collects zero information from the shopper — it shows the cart's line
items and a total, and "Place Order" immediately clears the cart. There is
no name, email, shipping address, or phone number captured anywhere in the
flow, so even once an order is persisted there would be no indication of
who placed it or where it should go. This is a different gap from the
order-history proposal in this folder: that proposal is entirely about
*persisting and retrieving* an order server-side (an `Order`/`OrderItem`
model, a device-local list of placed order ids) and explicitly leaves
`CheckoutScreen`'s fields untouched aside from wiring in an API call —
it never adds any shopper-entered data. None of the other proposals here
(search/sort/wishlist/recently-viewed/ratings/stock) touch checkout at
all. A marketplace that can't collect a delivery address is missing a
basic, load-bearing piece of the checkout flow, and it's a natural
companion to (and unblocks) order-history actually meaning something once
an address exists to attach to an order.

## Proposed approach

Shared logic and UI in `components-library`, with `web-application` and
`mobile-application` staying thin wrappers, same as the rest of the
checkout flow:

1. **Shared form state hook** — add
   `components-library/src/business/CheckoutScreen/useShippingDetailsForm.ts`:
   holds `{ fullName, email, addressLine1, addressLine2, city, postalCode,
   country, phone }` in local state, exposes `setField`, and a pure
   `validate()` that returns per-field error messages (required:
   `fullName`, `email`, `addressLine1`, `city`, `postalCode`, `country`;
   format check on `email`). Kept as a plain hook (no zustand/persistence)
   since this is transient, page-local input, not shared state like the
   cart — nothing else in the app needs to read it.

2. **Form UI inside `CheckoutScreen`** — render a "Shipping details"
   section above the existing line-items/total block, built from the
   already-shared `common/Input/Input.tsx` for each field (one `Input` per
   field, label as accessible placeholder/label text, error text rendered
   below a field when `validate()` flags it and the field has been
   touched). This stays inside the single shared `CheckoutScreen.tsx` —
   no platform split needed, matching how the rest of the screen already
   works identically on both platforms.

3. **Gate "Place Order" on validity** — `placeOrder()` runs `validate()`
   first; if there are errors, mark all fields touched (so messages show)
   and don't clear the cart. Only proceed (today: set `placedTotal` and
   `clear()`; after the order-history proposal lands: call `onPlaceOrder`)
   when the form is valid. This proposal doesn't depend on order-history
   landing first — it works standalone against the current stub, and if
   order-history lands separately, its `onPlaceOrder(items)` call site
   just also has the validated shipping details available to pass along.

4. **Confirmation state** — show the entered `fullName`/address summary
   alongside the existing "Order placed!" total, so the shopper can
   confirm what they submitted.

## Key files/areas

- New: `components-library/src/business/CheckoutScreen/useShippingDetailsForm.ts`
  (+ `useShippingDetailsForm.test.ts`)
- Edit: `components-library/src/business/CheckoutScreen/CheckoutScreen.tsx`
  (shipping form section, validation gate, confirmation summary)
- Edit: `components-library/src/business/CheckoutScreen/CheckoutScreen.stories.tsx`,
  `CheckoutScreen.web.test.tsx` (cover the new fields/validation/confirmation)
- No changes needed to `web-application/app/checkout/page.tsx`,
  `mobile-application/src/app/(tabs)/cart/checkout.tsx`, `useCartStore.ts`,
  or the API layer — this stays entirely inside the shared screen
  component, same as search/filtering today.

## Verification

- Unit tests for `useShippingDetailsForm.ts`: required-field validation,
  email format validation, `validate()` returning no errors for a
  fully-filled valid form.
- `CheckoutScreen.web.test.tsx` extended: submitting with empty/invalid
  fields shows error messages and does not clear the cart; submitting a
  valid form proceeds to the existing "Order placed!" state and shows the
  entered name/address on it.
- Manual pass on both apps: attempt to place an order with missing/invalid
  fields and confirm inline errors appear without losing cart contents;
  fill in valid shipping details and confirm the order completes and the
  confirmation screen shows what was entered.
