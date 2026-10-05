import { useEffect, useMemo, useRef, type ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
import { Product } from "../../common/Product/Product"
import { SearchInput } from "../../common/SearchInput/SearchInput"
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
   * The debounced search term, reported upwards so the owning page can re-run its
   * catalogue query with it. Optional: a screen given a fixed `products` array (a
   * story, a test) filters it locally and needs no request.
   *
   * See `ProductListScreen.tsx` for why the term has to reach the server rather
   * than filter the pages already loaded.
   */
  onQueryChange?: (query: string) => void
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
  const { query, setQuery, settledQuery, sortBy, setSortBy, priceRange, setPriceRange, results } =
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

  // Reported from an effect rather than during render so the parent's state
  // update is a separate commit — setting state mid-render is a React error, and
  // `onQueryChange` is a plain `setState` in both apps.
  useEffect(() => {
    onQueryChange?.(settledQuery)
  }, [onQueryChange, settledQuery])

  return (
    <ClassNameView testID="product-list-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
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
        {!isLoading && !error && products.length === 0 && !query.trim() ? (
          <ClassNameText className="text-muted">No products yet.</ClassNameText>
        ) : null}
        {/* Keyed on `results`, not on `products.length`: a search that matched
            nothing leaves `products` empty too, and "No products yet." is a
            statement about the catalogue, not about the term just typed. */}
        {!isLoading && !error && results.length === 0 && (query.trim() || products.length > 0) ? (
          <ClassNameText className="text-muted">
            {query && isPriceRangeActive
              ? `No products match "${query}" in this price range.`
              : isPriceRangeActive
                ? "No products match this price range."
                : `No products match "${query}".`}
          </ClassNameText>
        ) : null}
        <ClassNameView className="grid grid-cols-[repeat(auto-fill,minmax(192px,1fr))] gap-4">
          {productElements}
        </ClassNameView>
        <View ref={sentinelRef} testID="product-list-sentinel" />
        {isFetchingNextPage ? (
          <ClassNameText className="text-muted">Loading more…</ClassNameText>
        ) : null}
      </ClassNameView>
    </ClassNameView>
  )
}
