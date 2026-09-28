import { useMemo, type ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Product } from "../../common/Product/Product"
import type { ProductData } from "../../types/Product"
import { SearchBar } from "./SearchBar"
import { useProductSearch } from "./useProductSearch"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ProductListScreenProps = {
  products: ProductData[]
  isLoading?: boolean
  error?: Error | null
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  onEndReached?: () => void
  onSelectProduct?: (id: string) => void
}

function isCloseToBottom({ layoutMeasurement, contentOffset, contentSize }: NativeScrollEvent) {
  return layoutMeasurement.height + contentOffset.y >= contentSize.height - 200
}

export function ProductListScreen({
  products,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
  onSelectProduct,
}: ProductListScreenProps) {
  const { query, setQuery, results } = useProductSearch(products)

  // stable element references so unrelated re-renders (e.g.
  // isFetchingNextPage flipping) don't recreate every card's onPress
  // closure and force React to re-render cards that haven't changed.
  const productElements = useMemo(
    () =>
      results.map((product) => (
        <Product key={product.id} {...product} onPress={() => onSelectProduct?.(product.id)} />
      )),
    [results, onSelectProduct],
  )

  function handleScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    if (isCloseToBottom(nativeEvent) && hasNextPage && !isFetchingNextPage) {
      onEndReached?.()
    }
  }

  return (
    <ClassNameScrollView
      testID="product-list-screen"
      className="flex-1 bg-background"
      onScroll={handleScroll}
      scrollEventThrottle={400}
    >
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">
          Marketplace
        </ClassNameText>
        <SearchBar value={query} onChangeText={setQuery} />
        {isLoading ? <ClassNameText className="text-muted">Loading products…</ClassNameText> : null}
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}
        {!isLoading && !error && products.length === 0 ? (
          <ClassNameText className="text-muted">No products yet.</ClassNameText>
        ) : null}
        {!isLoading && !error && products.length > 0 && results.length === 0 ? (
          <ClassNameText className="text-muted">No products match "{query}".</ClassNameText>
        ) : null}
        <ClassNameView className="flex-row flex-wrap gap-4">{productElements}</ClassNameView>
        {isFetchingNextPage ? (
          <ClassNameText className="text-muted">Loading more…</ClassNameText>
        ) : null}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
