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
  const t = useT()
  const { locale } = useLocale()
  const tag = localeTag(locale)

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
      <ScreenHeader title={t("cartTitle")} testID="cart-title" />
      <ClassNameView className="gap-4 px-6 pb-6">
        {error ? (
          <ClassNameText className="text-foreground">{t("cartError")}: {error.message}</ClassNameText>
        ) : null}
        {/* A line that silently disappears is worse than one that says so: the
            shopper would have no idea what the total just stopped counting. */}
        {missing.length > 0 ? (
          <ClassNameView className="gap-2">
            <ClassNameText testID="cart-missing" className="text-sm text-muted">
              {missing.length === 1
                ? t("cartMissingOne")
                : t("cartMissingMany", { count: missing.length })}
            </ClassNameText>
            <Button
              label={t("cartRemoveUnavailable")}
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
          <ClassNameText className="text-muted">{t("cartLoading")}</ClassNameText>
        ) : lineItems.length === 0 ? (
          <ClassNameText className="text-muted">{t("cartEmpty")}</ClassNameText>
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
                      {formatPrice(product.price, product.currency, tag)} {t("cartEach")}
                    </ClassNameText>
                  </ClassNameView>
                  <ClassNameView className="flex-row items-center gap-2">
                    <Button
                      label={t("cartDecrease", { title: product.title })}
                      testId={`cart-decrease-${product.id}`}
                      variant="secondary"
                      onPress={() => decrementQuantity(product.id)}
                    >
                      <ClassNameText className="text-foreground">-</ClassNameText>
                    </Button>
                    <ClassNameText className="text-sm text-foreground">{quantity}</ClassNameText>
                    <Button
                      label={t("cartIncrease", { title: product.title })}
                      testId={`cart-increase-${product.id}`}
                      variant="secondary"
                      onPress={() => incrementQuantity(product.id)}
                    >
                      <ClassNameText className="text-foreground">+</ClassNameText>
                    </Button>
                  </ClassNameView>
                  <Button
                    label={t("cartRemove")}
                    variant="secondary"
                    accessibilityLabel={t("cartRemoveFromCart", { title: product.title })}
                    testId={`cart-remove-${product.id}`}
                    onPress={() => removeItem(product.id)}
                  />
                </ClassNameView>
              ))}
            </ClassNameView>
            <ClassNameText className="text-lg font-bold text-brand">
              {t("cartTotal", { total: formatPrice(getCartTotalPrice(lineItems), "USD", tag) })}
            </ClassNameText>
            <Button
              label={t("cartCheckout")}
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
