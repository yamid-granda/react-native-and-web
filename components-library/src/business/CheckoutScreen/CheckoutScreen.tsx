import { useState, type ComponentType } from "react"
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type PressableProps,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { formatPrice } from "../../utils/formatPrice"
import { getCartTotalPrice, useCartStore } from "../CartScreen/useCartStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

export type CheckoutScreenProps = {
  onGoToCart?: () => void
  onContinueShopping?: () => void
}

export function CheckoutScreen({ onGoToCart, onContinueShopping }: CheckoutScreenProps) {
  const items = useCartStore((state) => state.items)
  const clear = useCartStore((state) => state.clear)
  const [placedTotal, setPlacedTotal] = useState<number | null>(null)

  const lineItems = Object.values(items)

  function placeOrder() {
    // must read the total before clear() empties items, or it'd read 0
    setPlacedTotal(getCartTotalPrice(items))
    clear()
  }

  return (
    <ClassNameScrollView testID="checkout-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">Checkout</ClassNameText>
        {placedTotal !== null ? (
          <>
            <ClassNameText className="text-lg font-semibold text-foreground">
              Order placed!
            </ClassNameText>
            <ClassNameText className="text-lg font-bold text-brand">
              {formatPrice(placedTotal)}
            </ClassNameText>
            <ClassNamePressable
              accessibilityRole="button"
              onPress={() => onContinueShopping?.()}
              className="items-center justify-center self-start rounded-lg bg-brand px-4 py-3 active:bg-brand-dark"
            >
              <ClassNameText className="text-base font-semibold text-white">
                Continue Shopping
              </ClassNameText>
            </ClassNamePressable>
          </>
        ) : lineItems.length === 0 ? (
          <>
            <ClassNameText className="text-muted">Your cart is empty.</ClassNameText>
            <ClassNamePressable accessibilityRole="button" onPress={() => onGoToCart?.()}>
              <ClassNameText className="text-sm text-brand">Go to Cart</ClassNameText>
            </ClassNamePressable>
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
            <ClassNameText className="text-lg font-bold text-brand">
              Total: {formatPrice(getCartTotalPrice(items))}
            </ClassNameText>
            <ClassNamePressable
              accessibilityRole="button"
              onPress={placeOrder}
              className="items-center justify-center self-start rounded-lg bg-brand px-4 py-3 active:bg-brand-dark"
            >
              <ClassNameText className="text-base font-semibold text-white">
                Place Order
              </ClassNameText>
            </ClassNamePressable>
          </>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
