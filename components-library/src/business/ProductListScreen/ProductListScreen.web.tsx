import { useEffect, useMemo, useRef, type ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { Product } from "../../common/Product/Product"
import { SearchInput } from "../../common/SearchInput/SearchInput"
import { ScreenHeader } from "../../common/ScreenHeader/ScreenHeader"
import { ProductFilterControls } from "../../common/ProductFilterControls/ProductFilterControls"
import type { ProductData } from "../../types/Product"
import { useProductSearch } from "./useProductSearch"
import { useRecentlyViewedStore } from "../ProductDetailScreen/useRecentlyViewedStore"
import { useProductLookup, type FetchProductsByIds } from "../ProductLookup/useProductLookup"

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
  /**
   * Fires with the **debounced** search query (`useDeferredValue` already
   * mediates typing). The page owns the actual `q` and re-runs
   * `useInfiniteProducts` when it changes — the list screen is the input's
   * source of truth, the page is the request's source of truth.
   */
  onQueryChange?: (q: string) => void
  /** Resolves the recently-viewed rail. Props in, no fetching here — see `StoreScreen`. */
  fetchProductsByIds: FetchProductsByIds
}

export function ProductListScreen({
  products,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  onEndReached,
  onSelectProduct,
  onQueryChange,
  fetchProductsByIds,
}: ProductListScreenProps) {
  const { query, setQuery, sortBy, setSortBy, priceRange, setPriceRange, results, deferredQuery } =
    useProductSearch(products)
  const isPriceRangeActive = priceRange.min !== undefined || priceRange.max !== undefined
  const sentinelRef = useRef<View>(null)
  const recentlyViewedIds = useRecentlyViewedStore((state) => state.ids)
  // Same lookup the cart and the wishlist use, so the rail is priced by the same
  // request as the grid below it rather than by whenever the shopper last opened
  // each of those ten products.
  const { byId } = useProductLookup(recentlyViewedIds, fetchProductsByIds)
  const recentlyViewed = recentlyViewedIds.flatMap((id) => {
    const product = byId[id]
    return product ? [product] : []
  })
  const showRecentlyViewed = recentlyViewed.length > 0 && !query.trim()

  // The deferred query drives the server-side refetch: the page forwards it
  // to `useInfiniteProducts`, which folds it into the React Query key so a
  // fresh query resets pagination and a stale page 1 from another search
  // cannot leak into this one.
  useEffect(() => {
    onQueryChange?.(deferredQuery)
  }, [deferredQuery, onQueryChange])

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

  // The page scrolls at the document level (see web-application's
  // layout.tsx: fixed BottomNav, unbounded body height), so an
  // IntersectionObserver against the viewport is used instead of a
  // ScrollView's onScroll — that only fires for a bounded-height scroll
  // container, which this component never has on web.
  useEffect(() => {
    const sentinel = sentinelRef.current as unknown as Element | null
    if (!sentinel || !hasNextPage || isFetchingNextPage) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) onEndReached?.()
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, onEndReached])

  return (
    <ClassNameView testID="product-list-screen" className="flex-1 bg-background">
      <ScreenHeader title="Marketplace" testID="marketplace-title" />
      <ClassNameView className="gap-4 px-6 pb-6 md:px-8">
        <SearchInput value={query} onChangeText={setQuery} />
        {/* Mobile: filters stack above the grid. Desktop (`lg:`): filters become
            the §8 left rail (`w-60 sticky top-20`), the grid takes the rest. */}
        <ClassNameView className="gap-4 lg:flex-row lg:gap-6">
          <ClassNameView
            testID="marketplace-filters-rail"
            className="lg:w-60 lg:flex-shrink-0 lg:self-start lg:sticky lg:top-20"
          >
            <ProductFilterControls
              sortBy={sortBy}
              onSortByChange={setSortBy}
              priceRange={priceRange}
              onPriceRangeChange={setPriceRange}
            />
          </ClassNameView>
          <ClassNameView className="flex-1 gap-4 lg:min-w-0">
        {showRecentlyViewed ? (
          <ClassNameView className="gap-2">
            <ClassNameText className="text-base font-semibold text-foreground">
              Recently viewed
            </ClassNameText>
            <ClassNameView className="flex-row gap-4 overflow-x-auto pb-2">
              {recentlyViewed.map((product) => (
                <Product
                  key={product.id}
                  {...product}
                  onPress={() => onSelectProduct?.(product.id)}
                  className="w-36 flex-shrink-0"
                />
              ))}
            </ClassNameView>
          </ClassNameView>
        ) : null}
        {isLoading ? <ClassNameText className="text-muted">Loading products…</ClassNameText> : null}
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
        {/* Catalogue columns (§8): exactly 2 on phone — including 320/360px,
            where auto-fill/minmax(168px) collapses to 1 — then 3/4/5. */}
        <ClassNameView
          testID="marketplace-grid"
          className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
        >
          {productElements}
        </ClassNameView>
        <View ref={sentinelRef} testID="product-list-sentinel" />
        {isFetchingNextPage ? (
          <ClassNameText className="text-muted">Loading more…</ClassNameText>
        ) : null}
          </ClassNameView>
        </ClassNameView>
      </ClassNameView>
    </ClassNameView>
  )
}
