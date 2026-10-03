import { useEffect, useState, type ComponentType } from "react"
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
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
import type { ProductData } from "../../types/Product"
import { useCartStore } from "../CartScreen/useCartStore"
import { useRecentlyViewedStore } from "./useRecentlyViewedStore"
import { isWishlisted, useWishlistStore } from "../WishlistScreen/useWishlistStore"
import { Drawer } from "../../common/Drawer/Drawer"
import { Button } from "../../common/Button/Button"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"

const LOW_STOCK_THRESHOLD = 5

function stockLabel(stock: number) {
  if (stock === 0) return "Out of stock"
  if (stock <= LOW_STOCK_THRESHOLD) return `Only ${stock} left`
  return "In stock"
}

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>

export type ProductDetailScreenProps = {
  product?: ProductData | null
  isLoading?: boolean
  error?: Error | null
  onGoToCart?: () => void
  /**
   * Opens the seller's storefront. Supplied by the app, because routing is the
   * app's business — same rule as `onGoToCart`.
   *
   * Omitted, the "Sold by" line still renders as plain text: a product with a
   * seller is worth naming even where there is nowhere to navigate to.
   */
  onOpenStore?: (storeId: string) => void
}

export function ProductDetailScreen({
  product,
  isLoading,
  error,
  onGoToCart,
  onOpenStore,
}: ProductDetailScreenProps) {
  const addItem = useCartStore((state) => state.addItem)
  const recordView = useRecentlyViewedStore((state) => state.recordView)
  const wishlisted = useWishlistStore((state) => (product ? isWishlisted(state.items, product.id) : false))
  const toggleWishlistItem = useWishlistStore((state) => state.toggleItem)
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the id, not the object, so a same-id re-fetch (new object, unchanged id) doesn't re-record it
  useEffect(() => {
    if (product) recordView(product)
  }, [product?.id])

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
          <ClassNameText className="text-sm text-muted">{stockLabel(product.stock)}</ClassNameText>
          {/* Inline rather than a new common/ component: it has exactly one call
              site, and the pressable wrapper is conditional so a seeded product
              with no seller is not focusable at all. */}
          {product.storeName ? (
            <ClassNamePressable
              accessibilityRole="button"
              accessibilityLabel={`Sold by ${product.storeName}`}
              disabled={!product.storeId || !onOpenStore}
              onPress={() => {
                if (product.storeId) onOpenStore?.(product.storeId)
              }}
              className={onOpenStore ? "self-start" : undefined}
            >
              <ClassNameText
                testID="product-detail-store"
                className={onOpenStore ? "text-sm text-brand" : "text-sm text-muted"}
              >
                Sold by {product.storeName}
              </ClassNameText>
            </ClassNamePressable>
          ) : null}
          <ClassNameView className="flex-row items-center gap-3">
            <ClassNamePressable
              accessibilityRole="button"
              disabled={product.stock === 0}
              onPress={() => {
                addItem(product)
                setIsCartDrawerOpen(true)
              }}
              className={cn(
                "items-center justify-center self-start rounded-lg bg-brand px-4 py-3 active:bg-brand-dark",
                product.stock === 0 && "opacity-50",
              )}
            >
              <ClassNameText className="text-base font-semibold text-white">
                {product.stock === 0 ? "Out of stock" : "Add to Cart"}
              </ClassNameText>
            </ClassNamePressable>
            <ClassNamePressable
              accessibilityRole="button"
              accessibilityLabel={
                wishlisted ? `Remove ${product.title} from wishlist` : `Add ${product.title} to wishlist`
              }
              onPress={() => toggleWishlistItem(product)}
              className="h-11 w-11 items-center justify-center rounded-full bg-surface active:bg-surface-muted"
            >
              <HeartIcon filled={wishlisted} className={wishlisted ? "text-brand" : "text-muted"} />
            </ClassNamePressable>
          </ClassNameView>
        </>
      ) : null}
      <Drawer visible={isCartDrawerOpen} onClose={() => setIsCartDrawerOpen(false)}>
        <ClassNameText className="text-lg font-semibold text-foreground">Added to cart</ClassNameText>
        <ClassNameText className="text-muted">
          {product?.title} has been added to your cart.
        </ClassNameText>
        <Button
          label="Go to Cart"
          onPress={() => {
            setIsCartDrawerOpen(false)
            onGoToCart?.()
          }}
          className="mt-2"
        />
      </Drawer>
    </ClassNameView>
  )
}
