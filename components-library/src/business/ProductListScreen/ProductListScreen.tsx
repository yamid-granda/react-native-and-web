import { useCallback, type ComponentType } from "react"
import {
  FlatList,
  Text,
  View,
  type ListRenderItemInfo,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Product } from "../../common/Product/Product"
import type { ProductData } from "../../types/Product"
import { SearchBar } from "./SearchBar"
import { useProductSearch } from "./useProductSearch"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
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

// FlatList, not ScrollView + flex-wrap: it virtualizes (mounts/unmounts
// offscreen rows), which is the actual fix for the marketplace getting
// slow with many loaded products — a plain ScrollView never unmounts
// anything. Kept native-only (see ProductListScreen.web.tsx) since
// react-native-web's FlatList would need gap-4's free flex-wrap spacing
// reworked into columnWrapperStyle for a problem that's mobile-only —
// same Platform-split precedent as BottomNav's nativeOverlayStyle
// (README "Architecture boundaries").
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

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ProductData>) => (
      <Product {...item} onPress={() => onSelectProduct?.(item.id)} />
    ),
    [onSelectProduct],
  )

  return (
    <ClassNameView testID="product-list-screen" className="flex-1 bg-background">
      <FlatList
        data={results}
        keyExtractor={(product) => product.id}
        renderItem={renderItem}
        numColumns={2}
        columnWrapperStyle={{ gap: 16 }}
        contentContainerStyle={{ gap: 16, paddingHorizontal: 24, paddingBottom: 24 }}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) onEndReached?.()
        }}
        onEndReachedThreshold={0.5}
        removeClippedSubviews
        initialNumToRender={10}
        windowSize={7}
        ListHeaderComponent={
          <ClassNameView className="gap-4 pt-6 pb-4">
            <ClassNameText className="text-2xl font-semibold text-foreground">
              Marketplace
            </ClassNameText>
            <SearchBar value={query} onChangeText={setQuery} />
            {isLoading ? (
              <ClassNameText className="text-muted">Loading products…</ClassNameText>
            ) : null}
            {error ? (
              <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
            ) : null}
            {!isLoading && !error && products.length === 0 ? (
              <ClassNameText className="text-muted">No products yet.</ClassNameText>
            ) : null}
            {!isLoading && !error && products.length > 0 && results.length === 0 ? (
              <ClassNameText className="text-muted">No products match "{query}".</ClassNameText>
            ) : null}
          </ClassNameView>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ClassNameText className="text-muted">Loading more…</ClassNameText>
          ) : null
        }
      />
    </ClassNameView>
  )
}
