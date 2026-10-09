import { useMemo, type ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Product } from "../../common/Product/Product"
import { ScreenHeader } from "../../common/ScreenHeader/ScreenHeader"
import { useT } from "../../i18n/LocaleContext"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

// Matches ProductListScreen's native grid: RN has no auto-fill/minmax, so the
// column count is derived from the window the same way the browser's `grid` would.
const CARD_MIN_WIDTH = 150
const GRID_GAP = 16
const HORIZONTAL_PADDING = 24

export type PublicStoreScreenProps = {
  storeName: string
  products: ProductData[]
  isLoading?: boolean
  error?: Error | null
  onSelectProduct?: (id: string) => void
}

/**
 * The public storefront: one seller's name and everything they list.
 *
 * Reuses `common/Product` rather than a card of its own, so a storefront product
 * and a marketplace product are literally the same component — including the
 * wishlist toggle, which is why a shopper can wishlist from either.
 */
export function PublicStoreScreen({
  storeName,
  products,
  isLoading,
  error,
  onSelectProduct,
}: PublicStoreScreenProps) {
  const { width } = useWindowDimensions()
  const t = useT()
  const columns = useMemo(() => {
    const available = width - HORIZONTAL_PADDING * 2
    return Math.max(1, Math.floor((available + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)))
  }, [width])

  return (
    <ClassNameScrollView testID="public-store-screen" className="flex-1 bg-background">
      <ScreenHeader title={storeName} subtitle={t("publicStoreSubtitle")} testID="public-store-title" />
      <ClassNameView className="gap-4 px-6 pb-6">

        {isLoading ? <ClassNameText className="text-muted">{t("publicStoreLoading")}</ClassNameText> : null}
        {error ? (
          <ClassNameText className="text-foreground">{t("cartError")}: {error.message}</ClassNameText>
        ) : null}
        {!isLoading && !error && products.length === 0 ? (
          <ClassNameText className="text-muted">{t("publicStoreEmpty")}</ClassNameText>
        ) : null}

        <ClassNameView className="flex-row flex-wrap" style={{ gap: GRID_GAP }}>
          {products.map((product) => (
            <Product
              key={product.id}
              {...product}
              onPress={() => onSelectProduct?.(product.id)}
              className={columns > 1 ? "flex-1" : "w-full"}
            />
          ))}
        </ClassNameView>
      </ClassNameView>
    </ClassNameScrollView>
  )
}