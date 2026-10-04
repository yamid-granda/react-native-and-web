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
import { useCartStore } from "../CartScreen/useCartStore"
import { useWishlistStore } from "./useWishlistStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export function WishlistScreen() {
  const items = useWishlistStore((state) => state.items)
  const removeItem = useWishlistStore((state) => state.removeItem)
  const addItem = useCartStore((state) => state.addItem)

  const products = Object.values(items)

  return (
    <ClassNameScrollView testID="wishlist-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">Wishlist</ClassNameText>
        {products.length === 0 ? (
          <ClassNameText className="text-muted">Your wishlist is empty.</ClassNameText>
        ) : (
          <ClassNameView className="gap-3">
            {products.map((product) => (
              <ClassNameView
                key={product.id}
                className="flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3"
              >
                <ClassNameView className="flex-1 gap-1">
                  <ClassNameText className="text-sm font-semibold text-foreground">
                    {product.title}
                  </ClassNameText>
                  <ClassNameText className="text-xs text-muted">
                    {formatPrice(product.price, product.currency)}
                  </ClassNameText>
                </ClassNameView>
                <Button
                  label="Add to Cart"
                  size="sm"
                  testID={`add-to-cart-${product.id}`}
                  onPress={() => addItem(product)}
                />
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`Remove ${product.title} from wishlist`}
                  testID={`remove-${product.id}`}
                  onPress={() => removeItem(product.id)}
                />
              </ClassNameView>
            ))}
          </ClassNameView>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
