"use client"

import { useRouter } from "solito/navigation"
import { ProductListScreen, useInfiniteProducts } from "@rnw/components-library"
import { fetchProducts } from "../../lib/api"

export default function MarketplacePage() {
  const router = useRouter()
  const { products, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteProducts(fetchProducts)

  return (
    <ProductListScreen
      products={products}
      isLoading={isLoading}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onEndReached={() => fetchNextPage()}
      onSelectProduct={(id) => router.push(`/marketplace/${id}`)}
    />
  )
}
