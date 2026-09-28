import { router } from "expo-router"
import { useInfiniteQuery } from "@tanstack/react-query"
import { ProductListScreen } from "@rnw/components-library"
import { fetchProducts } from "../../../api/client"

export default function MarketplaceScreen() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["products"],
    queryFn: ({ pageParam }) => fetchProducts(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
  })

  const products = data?.pages.flatMap((page) => page.items) ?? []

  return (
    <ProductListScreen
      products={products}
      isLoading={isLoading}
      error={error}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      onEndReached={() => fetchNextPage()}
      onSelectProduct={(productId) =>
        router.push({ pathname: "/marketplace/[id]", params: { id: productId } })
      }
    />
  )
}
