import type { ComponentType } from "react"
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
import { getCartTotalPrice, useCartStore } from "./useCartStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type CartScreenProps = {
  onCheckout?: () => void
  /** Props in, no fetching here — see `StoreScreen` for why. */
  fetchProductsByIds: FetchProductsByIds
}

export function CartScreen({ onCheckout, fetchProductsByIds }: CartScreenProps) {
  const items = useCartStore((state) => state.items)
  const removeItem = useCartStore((state) => state.removeItem)
  const incrementQuantity = useCartStore((state) => state.incrementQuantity)
  const decrementQuantity = useCartStore((state) => state.decrementQuantity)

  const ids = Object.keys(items)
  const { byId, missing, isLoading, error } = useProductLookup(ids, fetchProductsByIds)

  // Resolved against the store's own order, so a line never moves because the
  // server happened to return the products in a different order.
  const lineItems = ids.flatMap((id) => {
    const product = byId[id]
    const quantity = items[id]?.quantity
    return product && quantity ? [{ product, quantity }] : []
  })

  return (
    <ClassNameScrollView testID="cart-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">Cart</ClassNameText>
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}
        {/* A line that silently disappears is worse than one that says so: the
            shopper would have no idea what the total just stopped counting. */}
        {missing.length > 0 ? (
          <ClassNameView className="gap-2">
            <ClassNameText testID="cart-missing" className="text-sm text-muted">
              {missing.length === 1
                ? "1 saved item is no longer available."
                : `${missing.length} saved items are no longer available.`}
            </ClassNameText>
            <Button
              label="Remove unavailable items"
              testId="cart-remove-unavailable"
              variant="secondary"
              className="self-start"
              onPress={() => missing.forEach(removeItem)}
            />
          </ClassNameView>
        ) : null}
        {/* Error, then pending, then empty — see `WishlistScreen` for why the
            order is load-bearing: a failed lookup is reported above and must not
            also claim the cart is empty, and a cart still resolving has not
            answered yet. */}
        {error ? null : isLoading ? (
          <ClassNameText className="text-muted">Loading your cart…</ClassNameText>
        ) : lineItems.length === 0 ? (
          <ClassNameText className="text-muted">Your cart is empty.</ClassNameText>
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
                      {formatPrice(product.price, product.currency)} each
                    </ClassNameText>
                  </ClassNameView>
                  <ClassNameView className="flex-row items-center gap-2">
                    <Button
                      label={`Decrease ${product.title} quantity`}
                      testId={`cart-decrease-${product.id}`}
                      variant="secondary"
                      onPress={() => decrementQuantity(product.id)}
                    >
                      <ClassNameText className="text-foreground">-</ClassNameText>
                    </Button>
                    <ClassNameText className="text-sm text-foreground">{quantity}</ClassNameText>
                    <Button
                      label={`Increase ${product.title} quantity`}
                      testId={`cart-increase-${product.id}`}
                      variant="secondary"
                      onPress={() => incrementQuantity(product.id)}
                    >
                      <ClassNameText className="text-foreground">+</ClassNameText>
                    </Button>
                  </ClassNameView>
                  <Button
                    label="Remove"
                    variant="secondary"
                    accessibilityLabel={`Remove ${product.title} from cart`}
                    testId={`cart-remove-${product.id}`}
                    onPress={() => removeItem(product.id)}
                  />
                </ClassNameView>
              ))}
            </ClassNameView>
            <ClassNameText className="text-lg font-bold text-brand">
              Total: {formatPrice(getCartTotalPrice(lineItems))}
            </ClassNameText>
            <Button
              label="Proceed to Checkout"
              testId="cart-checkout"
              className="self-start"
              onPress={() => onCheckout?.()}
            />
          </>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
