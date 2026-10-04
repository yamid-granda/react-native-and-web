import { useState, type ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { formatPrice } from "../../utils/formatPrice"
import { Button } from "../../common/Button/Button"
import {
  useProductLookup,
  type FetchProductsByIds,
} from "../ProductLookup/useProductLookup"
import { getCartTotalPrice, useCartStore } from "../CartScreen/useCartStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type CheckoutScreenProps = {
  onGoToCart?: () => void
  onContinueShopping?: () => void
  /** Props in, no fetching here — see `StoreScreen` for why. */
  fetchProductsByIds: FetchProductsByIds
}

export function CheckoutScreen({
  onGoToCart,
  onContinueShopping,
  fetchProductsByIds,
}: CheckoutScreenProps) {
  const items = useCartStore((state) => state.items)
  const clear = useCartStore((state) => state.clear)
  const [placedTotal, setPlacedTotal] = useState<number | null>(null)

  const ids = Object.keys(items)
  const { byId, missing, isLoading, error } = useProductLookup(ids, fetchProductsByIds)

  // Joined against the store's order, then totalled — so the figure confirmed on
  // the next screen is computed from what the server just returned rather than
  // from whatever price happened to be in localStorage.
  const lineItems = ids.flatMap((id) => {
    const product = byId[id]
    const quantity = items[id]?.quantity
    return product && quantity ? [{ product, quantity }] : []
  })

  function placeOrder() {
    // must read the total before clear() empties items, or it'd read 0
    setPlacedTotal(getCartTotalPrice(lineItems))
    clear()
  }

  // Said out loud rather than dropped, for the same reason as the cart's: a line
  // that vanishes from an order summary looks like a bug, and the total would
  // just be quietly smaller. One element because the summary and its empty
  // state are the two places it can appear — the confirmation screen is the
  // third thing that must *not* show it, since by then nothing was dropped.
  const missingNotice =
    missing.length > 0 ? (
      <ClassNameText testID="checkout-missing" className="text-sm text-muted">
        {missing.length === 1
          ? "1 saved item is no longer available, so it is not part of this order."
          : `${missing.length} saved items are no longer available, so they are not part of this order.`}
      </ClassNameText>
    ) : null

  return (
    <ClassNameScrollView testID="checkout-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">Checkout</ClassNameText>
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}
        {placedTotal !== null ? (
          <>
            <ClassNameText className="text-lg font-semibold text-foreground">
              Order placed!
            </ClassNameText>
            <ClassNameText className="text-lg font-bold text-brand">
              {formatPrice(placedTotal)}
            </ClassNameText>
            <Button
              label="Continue Shopping"
              className="self-start"
              onPress={() => onContinueShopping?.()}
            />
          </>
          // Error, then pending, then empty — see `WishlistScreen` for why the
          // order is load-bearing. The confirmation above it is unaffected: an
          // order already placed has nothing left to look up.
        ) : error ? (
          null
        ) : isLoading ? (
          <ClassNameText className="text-muted">Loading your order…</ClassNameText>
        ) : lineItems.length === 0 ? (
          <>
            <ClassNameText className="text-muted">Your cart is empty.</ClassNameText>
            {missingNotice}
            <Button
              label="Go to Cart"
              variant="ghost"
              size="sm"
              className="self-start"
              onPress={() => onGoToCart?.()}
            />
          </>
        ) : (
          <>
            <ClassNameView className="gap-3">
              {lineItems.map(({ product, quantity }) => (
                <ClassNameView
                  key={product.id}
                  className="flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3"
                >
                  <ClassNameView className="flex-1 gap-1">
                    <ClassNameText className="text-sm font-semibold text-foreground">
                      {product.title}
                    </ClassNameText>
                    <ClassNameText className="text-xs text-muted">
                      {quantity} × {formatPrice(product.price, product.currency)}
                    </ClassNameText>
                  </ClassNameView>
                  <ClassNameText className="text-sm font-semibold text-foreground">
                    {formatPrice(product.price * quantity, product.currency)}
                  </ClassNameText>
                </ClassNameView>
              ))}
            </ClassNameView>
            {missingNotice}
            <ClassNameText className="text-lg font-bold text-brand">
              Total: {formatPrice(getCartTotalPrice(lineItems))}
            </ClassNameText>
            <Button label="Place Order" className="self-start" onPress={placeOrder} />
          </>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
