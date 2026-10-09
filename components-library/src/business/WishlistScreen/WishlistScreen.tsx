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
import { ScreenHeader } from "../../common/ScreenHeader/ScreenHeader"
import { useLocale, useT } from "../../i18n/LocaleContext"
import { localeTag } from "../../i18n/resolveLocale"
import { useCartStore } from "../CartScreen/useCartStore"
import { useProductLookup, type FetchProductsByIds } from "../ProductLookup/useProductLookup"
import { useWishlistStore } from "./useWishlistStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type WishlistScreenProps = {
  /** Props in, no fetching here — see `StoreScreen` for why. */
  fetchProductsByIds: FetchProductsByIds
}

export function WishlistScreen({ fetchProductsByIds }: WishlistScreenProps) {
  const ids = useWishlistStore((state) => state.ids)
  const removeItem = useWishlistStore((state) => state.removeItem)
  const addItem = useCartStore((state) => state.addItem)
  const t = useT()
  const { locale } = useLocale()
  const tag = localeTag(locale)

  const { byId, missing, isLoading, error } = useProductLookup(ids, fetchProductsByIds)

  // Joined against the store's order. `product` here is the *live* product, not
  // the snapshot the wishlist used to hold — which is why "Add to Cart" can no
  // longer carry a price from weeks ago into the cart.
  const products = ids.flatMap((id) => {
    const product = byId[id]
    return product ? [product] : []
  })

  // An id that no longer resolves is a saved item that cannot come back. It is
  // said out loud rather than silently shortening the list, and removable in one
  // press — an id that renders nothing is otherwise impossible to clear.
  const unavailableNotice =
    missing.length > 0 ? (
      <ClassNameView className="gap-2">
        <ClassNameText testID="wishlist-missing" className="text-sm text-muted">
          {missing.length === 1
            ? t("wishlistMissingOne")
            : t("wishlistMissingMany", { count: missing.length })}
        </ClassNameText>
        <Button
          label={t("wishlistRemoveUnavailable")}
          testId="wishlist-remove-unavailable"
          variant="secondary"
          className="self-start"
          onPress={() => missing.forEach(removeItem)}
        />
      </ClassNameView>
    ) : null

  return (
    <ClassNameScrollView testID="wishlist-screen" className="flex-1 bg-background">
      <ScreenHeader title={t("wishlistTitle")} testID="wishlist-title" />
      <ClassNameView className="gap-4 px-6 pb-6">
        {error ? (
          <ClassNameText className="text-foreground">{t("cartError")}: {error.message}</ClassNameText>
        ) : null}
        {unavailableNotice}
        {/* In this order, and the order is the point: a lookup that failed is
            reported above and must not *also* claim the wishlist is empty, and a
            lookup still in flight has not answered yet — only a settled answer may
            say "empty". Checking `products.length` first got both wrong: an error
            rendered the empty state beside itself, and a pending list flashed
            "empty" before its first paint. */}
        {error ? null : isLoading ? (
          <ClassNameText className="text-muted">{t("wishlistLoading")}</ClassNameText>
        ) : products.length === 0 ? (
          <ClassNameText className="text-muted">{t("wishlistEmpty")}</ClassNameText>
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
                    {formatPrice(product.price, product.currency, tag)}
                  </ClassNameText>
                </ClassNameView>
                <Button
                  label={t("wishlistAddToCart")}
                  testId={`wishlist-add-to-cart-${product.id}`}
                  onPress={() => addItem(product.id)}
                />
                <Button
                  label={t("wishlistRemove")}
                  variant="secondary"
                  accessibilityLabel={t("wishlistRemoveFrom", { title: product.title })}
                  testId={`wishlist-remove-${product.id}`}
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
