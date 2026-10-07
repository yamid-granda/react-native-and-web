"use client"

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
 */
export function MarketplaceView({ initialPage }: { initialPage: ProductsPage }) {
  const router = useRouter()
  const { products, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteProducts(fetchProducts, initialPage)

  return (
    <ProductListScreen
      products={products}
      isLoading={isLoading}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onEndReached={() => fetchNextPage()}
      onSelectProduct={(id) => router.push(`/marketplace/${id}`)}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
