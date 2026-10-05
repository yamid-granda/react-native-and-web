"use client"

import { useState } from "react"
import { useRouter } from "solito/navigation"
import { ProductListScreen, useInfiniteProducts } from "@rnw/components-library"
import { fetchProducts, fetchProductsByIds } from "../../lib/api"

export default function MarketplacePage() {
  const router = useRouter()
  // The term lives here rather than inside the list screen because this is where
  // the catalogue query lives: the screen reports what was typed, and this page
  // re-asks the server for a list narrowed by it. Held here rather than in a
  // context so both apps' routes stay the only wiring.
  const [query, setQuery] = useState("")
  const { products, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteProducts(fetchProducts, query)

  return (
    <ProductListScreen
      products={products}
      isLoading={isLoading}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onEndReached={() => fetchNextPage()}
      onQueryChange={setQuery}
      onSelectProduct={(id) => router.push(`/marketplace/${id}`)}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
