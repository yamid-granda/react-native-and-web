import type { ComponentType } from "react"
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
import { useCartStore } from "../CartScreen/useCartStore"
import { useWishlistStore } from "./useWishlistStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

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
                <ClassNamePressable
                  accessibilityRole="button"
                  onPress={() => addItem(product)}
                  className="items-center justify-center rounded-lg bg-brand px-3 py-2 active:bg-brand-dark"
                >
                  <ClassNameText className="text-sm font-semibold text-white">
                    Add to Cart
                  </ClassNameText>
                </ClassNamePressable>
                <ClassNamePressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${product.title} from wishlist`}
                  onPress={() => removeItem(product.id)}
                >
                  <ClassNameText className="text-sm text-muted">Remove</ClassNameText>
                </ClassNamePressable>
              </ClassNameView>
            ))}
          </ClassNameView>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
