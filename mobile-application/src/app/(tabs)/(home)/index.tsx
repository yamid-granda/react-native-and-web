import { useCallback, useState } from "react"
import { router } from "expo-router"
import { ProductListScreen, useInfiniteProducts } from "@rnw/components-library"
import { fetchProducts, fetchProductsByIds } from "../../../api/client"

/**
 * Home is the marketplace list: the catalogue every shopper lands on.
 *
 * Mobile owns `q` here too: the list screen drives the input and its debounce,
 * the page owns the request and tells `useInfiniteProducts` about the change.
 * Folding `q` into the React Query key is what makes a fresh search reset
 * pagination rather than gluing new pages onto whatever was loaded first.
 */
export default function HomeRoute() {
  const [query, setQuery] = useState("")
  const handleQueryChange = useCallback((q: string) => setQuery(q), [])
  const { products, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteProducts(fetchProducts, undefined, query)

  return (
    <ProductListScreen
      products={products}
      isLoading={isLoading}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onEndReached={() => fetchNextPage()}
      onSelectProduct={(productId) =>
        router.push({ pathname: "/product/[id]", params: { id: productId } })
      }
      onQueryChange={handleQueryChange}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
