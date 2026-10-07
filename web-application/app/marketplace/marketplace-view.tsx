"use client"

import { useCallback, useState } from "react"
import { useRouter } from "solito/navigation"
import { ProductListScreen, useInfiniteProducts } from "@rnw/components-library"
import type { ProductsPage } from "@rnw/components-library"
import { fetchProducts, fetchProductsByIds } from "../../lib/api"

/**
 * The marketplace's client half.
 *
 * The first page arrives from the server component as a prop, so the product
 * grid is in the initial HTML for crawlers; React Query seeds its infinite query
 * with that page and takes over from page 2 on scroll. See `app/marketplace/page.tsx`.
 *
 * The active search `q` lives here too: the list screen owns the input (and
 * its debounce) and emits the deferred value up through `onQueryChange`. We
 * pass it back into `useInfiniteProducts`, which folds it into the React Query
 * key — so a fresh query resets pagination and a stale SSR'd page 1 cannot
 * leak into a search response. The seed is dropped the moment a query is set
 * for the same reason: `useInfiniteProducts` keeps the seed only when `q` is
 * empty/whitespace.
 */
export function MarketplaceView({ initialPage }: { initialPage: ProductsPage }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const handleQueryChange = useCallback((q: string) => setQuery(q), [])
  const { products, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteProducts(fetchProducts, initialPage, query)

  return (
    <ProductListScreen
      products={products}
      isLoading={isLoading}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onEndReached={() => fetchNextPage()}
      onSelectProduct={(id) => router.push(`/marketplace/${id}`)}
      onQueryChange={handleQueryChange}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
