import { useEffect, useMemo, useRef, type ComponentType } from "react"
import { Text, View, type TextProps, type ViewProps } from "react-native"
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
  const sentinelRef = useRef<View>(null)

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
