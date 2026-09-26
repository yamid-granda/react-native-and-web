import type { ComponentType } from "react"
import {
  Image,
  Pressable,
  Text,
  View,
  type ImageProps,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { formatPrice } from "../../utils/formatPrice"
import type { ProductData } from "../../types/Product"
import { useCartStore } from "../CartScreen/useCartStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

export type ProductDetailScreenProps = {
  product?: ProductData | null
  isLoading?: boolean
  error?: Error | null
}

export function ProductDetailScreen({ product, isLoading, error }: ProductDetailScreenProps) {
  const addItem = useCartStore((state) => state.addItem)

  return (
    <ClassNameView testID="product-detail-screen" className="flex-1 gap-4 bg-background p-6">
      {isLoading ? <ClassNameText className="text-muted">Loading product…</ClassNameText> : null}
      {error ? (
        <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
      ) : null}
      {!isLoading && !error && !product ? (
        <ClassNameText className="text-muted">Product not found.</ClassNameText>
      ) : null}
      {product ? (
        <>
          {product.imageUrl ? (
            <ClassNameImage
              source={{ uri: product.imageUrl }}
              accessibilityLabel={product.title}
              resizeMode="cover"
              className="h-64 w-full rounded-lg bg-surface-muted"
            />
          ) : null}
          <ClassNameText className="text-2xl font-semibold text-foreground">
            {product.title}
          </ClassNameText>
          {product.description ? (
            <ClassNameText className="text-base text-muted">{product.description}</ClassNameText>
          ) : null}
          <ClassNameText className="text-xl font-bold text-brand">
            {formatPrice(product.price, product.currency)}
          </ClassNameText>
          <ClassNamePressable
            accessibilityRole="button"
            onPress={() => addItem(product)}
            className="items-center justify-center self-start rounded-lg bg-brand px-4 py-3 active:bg-brand-dark"
          >
            <ClassNameText className="text-base font-semibold text-white">
              Add to Cart
            </ClassNameText>
          </ClassNamePressable>
        </>
      ) : null}
    </ClassNameView>
  )
}
