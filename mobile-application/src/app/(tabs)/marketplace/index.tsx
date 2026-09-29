import { useState } from "react"
import { router } from "expo-router"
import { ProductListScreen, useInfiniteProducts } from "@rnw/components-library"
import { fetchProducts } from "../../../api/client"

export default function MarketplaceScreen() {
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
      onSelectProduct={(productId) =>
        router.push({ pathname: "/marketplace/[id]", params: { id: productId } })
      }
    />
  )
}
