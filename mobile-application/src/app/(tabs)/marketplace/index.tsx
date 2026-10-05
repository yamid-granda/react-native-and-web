import { useState } from "react"
import { router } from "expo-router"
import { ProductListScreen, useInfiniteProducts } from "@rnw/components-library"
import { fetchProducts, fetchProductsByIds } from "../../../api/client"

export default function MarketplaceScreen() {
  // The term lives here rather than inside the list screen because this is where
  // the catalogue query lives: the screen reports what was typed, and this route
  // re-asks the server for a list narrowed by it. Without it a search only ever
  // saw the pages already loaded, and on this platform it could never load the
  // next one — a collapsed `FlatList` is not scrollable, so `onEndReached` never
  // fired and the product the shopper was looking for stayed unfetched.
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
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
