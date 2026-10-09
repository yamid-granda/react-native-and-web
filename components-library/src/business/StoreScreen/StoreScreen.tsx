import type { ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Button } from "../../common/Button/Button"
import { ScreenHeader } from "../../common/ScreenHeader/ScreenHeader"
import { formatPrice } from "../../utils/formatPrice"
import { useLocale, useT } from "../../i18n/LocaleContext"
import { localeTag } from "../../i18n/resolveLocale"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type StoreScreenProps = {
  storeName: string
  products: ProductData[]
  isLoading?: boolean
  error?: Error | null
  /** Set while a create, edit or delete is in flight. */
  isMutating?: boolean
  onCreate: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * My Store: the seller's own product list.
 *
 * A sibling of `CartScreen` and `WishlistScreen` — props in, no fetching here.
 * The reason is the same for all three: this package has no router, so a screen
 * that reached for one would need it injected per platform, and the alternative
 * (a near-copy per app) is worse.
 */
export function StoreScreen({
  storeName,
  products,
  isLoading,
  error,
  isMutating,
  onCreate,
  onEdit,
  onDelete,
}: StoreScreenProps) {
  const t = useT()
  const { locale } = useLocale()
  const tag = localeTag(locale)
  return (
    <ClassNameScrollView testID="store-screen" className="flex-1 bg-background">
      <ScreenHeader title={storeName} testID="store-title" />
      <ClassNameView className="gap-4 px-6 pb-6">

        {isLoading ? <ClassNameText className="text-muted">{t("storeLoading")}</ClassNameText> : null}
        {error ? (
          <ClassNameText className="text-foreground">{t("cartError")}: {error.message}</ClassNameText>
        ) : null}

        {!isLoading && !error && products.length === 0 ? (
          <ClassNameText className="text-muted">
            {t("storeEmpty")}
          </ClassNameText>
        ) : null}

        {products.length > 0 ? (
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
                    {product.stock === 0
                      ? ` · ${t("storeOutOfStock")}`
                      : ` · ${t("storeInStock", { count: product.stock })}`}
                  </ClassNameText>
                </ClassNameView>
                <Button
                  label={t("storeEdit")}
                  variant="secondary"
                  accessibilityLabel={t("storeEditAria", { title: product.title })}
                  testId={`store-edit-${product.id}`}
                  onPress={() => onEdit(product.id)}
                />
                <Button
                  label={t("storeDelete")}
                  variant="secondary"
                  accessibilityLabel={t("storeDeleteAria", { title: product.title })}
                  testId={`store-delete-${product.id}`}
                  disabled={isMutating}
                  onPress={() => onDelete(product.id)}
                />
              </ClassNameView>
            ))}
          </ClassNameView>
        ) : null}

        <Button
          label={t("storeAddProduct")}
          testId="store-add-product"
          onPress={onCreate}
          disabled={isMutating}
        />
      </ClassNameView>
    </ClassNameScrollView>
  )
}