import { useCallback, type ComponentType } from "react"
import {
  FlatList,
  Text,
  View,
  useWindowDimensions,
  type ListRenderItemInfo,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Product } from "../../common/Product/Product"
import { SearchInput } from "../../common/SearchInput/SearchInput"
import { ProductFilterControls } from "../../common/ProductFilterControls/ProductFilterControls"
import type { ProductData } from "../../types/Product"
import { useProductSearch } from "./useProductSearch"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

// Not the same 192px floor as ProductListScreen.web.tsx's
// grid-cols-[...minmax(192px,1fr)] — desktop viewports are wide enough for
// that to still yield several columns, but two 192px phone-width cards
// plus their gap and padding need ~448pt, more than any phone has (iPhones
// run ~375-430pt). 150px is the largest floor that still gives 2 columns
// across standard phone widths, while still growing on tablets.
const CARD_MIN_WIDTH = 150
const GRID_GAP = 16
const HORIZONTAL_PADDING = 24

// RN has no auto-fill/minmax grid primitive, so this reproduces it: derive
// how many CARD_MIN_WIDTH columns fit the current window, same as the
// browser does for the web grid, instead of a hardcoded numColumns.
function getColumnCount(windowWidth: number) {
  const available = windowWidth - HORIZONTAL_PADDING * 2
  return Math.max(1, Math.floor((available + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)))
}

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
  const { query, setQuery, sortBy, setSortBy, priceRange, setPriceRange, results } =
    useProductSearch(products)
  const isPriceRangeActive = priceRange.min !== undefined || priceRange.max !== undefined
  const { width } = useWindowDimensions()
  const numColumns = getColumnCount(width)

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ProductData>) => (
      // flex-1 divides a row's bounded width evenly across its columns.
      // With numColumns 1 there's no row wrapper — each card sits directly
      // in the list's auto-height column container, where flex-1's
      // flexBasis: 0% collapses it to near-zero height instead.
      <Product
        {...item}
        onPress={() => onSelectProduct?.(item.id)}
        className={numColumns > 1 ? "flex-1" : undefined}
      />
    ),
    [onSelectProduct, numColumns],
  )

  return (
    <ClassNameView testID="product-list-screen" className="flex-1 bg-background">
      <FlatList
        // FlatList can't change numColumns on a mounted list (RN invariant),
        // so the count is threaded through as a key to force a remount when
        // the window is resized (e.g. rotation, tablet split-view).
        key={numColumns}
        data={results}
        keyExtractor={(product) => product.id}
        renderItem={renderItem}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? { gap: GRID_GAP } : undefined}
        contentContainerStyle={{
          gap: GRID_GAP,
          paddingHorizontal: HORIZONTAL_PADDING,
          paddingBottom: 24,
        }}
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
            <SearchInput value={query} onChangeText={setQuery} />
            <ProductFilterControls
              sortBy={sortBy}
              onSortByChange={setSortBy}
              priceRange={priceRange}
              onPriceRangeChange={setPriceRange}
            />
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
              <ClassNameText className="text-muted">
                {query && isPriceRangeActive
                  ? `No products match "${query}" in this price range.`
                  : isPriceRangeActive
                    ? "No products match this price range."
                    : `No products match "${query}".`}
              </ClassNameText>
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
