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
import { getCartTotalPrice, useCartStore } from "./useCartStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type CartScreenProps = {
  onCheckout?: () => void
}

export function CartScreen({ onCheckout }: CartScreenProps) {
  const items = useCartStore((state) => state.items)
  const removeItem = useCartStore((state) => state.removeItem)
  const incrementQuantity = useCartStore((state) => state.incrementQuantity)
  const decrementQuantity = useCartStore((state) => state.decrementQuantity)

  const lineItems = Object.values(items)

  return (
    <ClassNameScrollView testID="cart-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">Cart</ClassNameText>
        {lineItems.length === 0 ? (
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
                      size="icon"
                      variant="secondary"
                      onPress={() => decrementQuantity(product.id)}
                    >
                      <ClassNameText className="text-foreground">-</ClassNameText>
                    </Button>
                    <ClassNameText className="text-sm text-foreground">{quantity}</ClassNameText>
                    <Button
                      label={`Increase ${product.title} quantity`}
                      size="icon"
                      variant="secondary"
                      onPress={() => incrementQuantity(product.id)}
                    >
                      <ClassNameText className="text-foreground">+</ClassNameText>
                    </Button>
                  </ClassNameView>
                  <Button
                    label="Remove"
                    variant="ghost"
                    size="sm"
                    accessibilityLabel={`Remove ${product.title} from cart`}
                    testID={`remove-${product.id}`}
                    onPress={() => removeItem(product.id)}
                  />
                </ClassNameView>
              ))}
            </ClassNameView>
            <ClassNameText className="text-lg font-bold text-brand">
              Total: {formatPrice(getCartTotalPrice(items))}
            </ClassNameText>
            <Button
              label="Proceed to Checkout"
              className="self-start"
              onPress={() => onCheckout?.()}
            />
          </>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
