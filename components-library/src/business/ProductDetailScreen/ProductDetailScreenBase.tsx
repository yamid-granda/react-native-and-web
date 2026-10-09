import { useEffect, useState, type ComponentType } from "react"
import { Image, Text, View, type ImageProps, type TextProps, type ViewProps } from "react-native"
import { formatPrice } from "../../utils/formatPrice"
import type { ProductData } from "../../types/Product"
import { useCartStore } from "../CartScreen/useCartStore"
import { useRecentlyViewedStore } from "./useRecentlyViewedStore"
import { isWishlisted, useWishlistStore } from "../WishlistScreen/useWishlistStore"
import { Drawer } from "../../common/Drawer/Drawer"
import { Button } from "../../common/Button/Button"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { useLocale, useT, type TFunction } from "../../i18n/LocaleContext"
import { localeTag } from "../../i18n/resolveLocale"

const LOW_STOCK_THRESHOLD = 5

function stockLabel(t: TFunction, stock: number) {
  if (stock === 0) return t("detailOutOfStock")
  if (stock <= LOW_STOCK_THRESHOLD) return t("detailOnlyLeft", { count: stock })
  return t("detailInStock")
}

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>

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
  const wishlisted = useWishlistStore((state) => (product ? isWishlisted(state.ids, product.id) : false))
  const toggleWishlistItem = useWishlistStore((state) => state.toggleItem)
  const [isCartDrawerOpen, setIsCartDrawerOpen] = useState(false)
  const t = useT()
  const { locale } = useLocale()
  const tag = localeTag(locale)

  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the id, not the object, so a same-id re-fetch (new object, unchanged id) doesn't re-record it
  useEffect(() => {
    if (product) recordView(product.id)
  }, [product?.id])

  return (
    <ClassNameView testID="product-detail-screen" className="flex-1 gap-4 bg-background p-6">
      {isLoading ? <ClassNameText className="text-muted">{t("detailLoading")}</ClassNameText> : null}
      {error ? (
        <ClassNameText className="text-foreground">{t("cartError")}: {error.message}</ClassNameText>
      ) : null}
      {!isLoading && !error && !product ? (
        <ClassNameText className="text-muted">{t("detailNotFound")}</ClassNameText>
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
            {formatPrice(product.price, product.currency, tag)}
          </ClassNameText>
          <ClassNameText className="text-sm text-muted">{stockLabel(t, product.stock)}</ClassNameText>
          {/* Inline rather than a new common/ component: it has exactly one call
              site, and the pressable wrapper is conditional so a seeded product
              with no seller is not focusable at all. */}
          {product.storeName ? (
            <Button
              label={t("detailSoldBy", { name: product.storeName })}
              variant="secondary"
              disabled={!product.storeId || !onOpenStore}
              onPress={() => {
                if (product.storeId) onOpenStore?.(product.storeId)
              }}
              // A store link that can't be opened has to read as inert rather
              // than as an invitation.
              labelClassName={onOpenStore ? undefined : "text-muted"}
              testId="product-detail-store"
              className={onOpenStore ? "self-start" : undefined}
            />
          ) : null}
          <ClassNameView className="flex-row items-center gap-3">
            <Button
              label={product.stock === 0 ? t("detailOutOfStock") : t("detailAddToCart")}
              testId="product-detail-add-to-cart"
              disabled={product.stock === 0}
              onPress={() => {
                addItem(product.id)
                setIsCartDrawerOpen(true)
              }}
            />
            <Button
              label={
                wishlisted
                  ? t("detailRemoveFromWishlist", { title: product.title })
                  : t("detailAddToWishlist", { title: product.title })
              }
              variant="secondary"
              testId={`wishlist-toggle-${product.id}`}
              onPress={() => toggleWishlistItem(product.id)}
            >
              <HeartIcon filled={wishlisted} className={wishlisted ? "text-brand" : "text-muted"} />
            </Button>
          </ClassNameView>
        </>
      ) : null}
      <Drawer visible={isCartDrawerOpen} onClose={() => setIsCartDrawerOpen(false)}>
        <ClassNameText className="text-lg font-semibold text-foreground">{t("detailAddedToCart")}</ClassNameText>
        <ClassNameText className="text-muted">
          {t("detailAddedToCartBody", { title: product?.title ?? "" })}
        </ClassNameText>
        <Button
          label={t("detailGoToCart")}
          testId="product-detail-go-to-cart"
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
