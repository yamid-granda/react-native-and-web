import { useInfiniteQuery } from "@tanstack/react-query"
import type { ProductsPage } from "../../types/Product"

export function useInfiniteProducts(
  fetchProducts: (page: number, query?: string) => Promise<ProductsPage>,
  query = "",
) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["products", query],
    queryFn: ({ pageParam }) => fetchProducts(pageParam, query || undefined),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
  })

  return {
    products: data?.pages.flatMap((page) => page.items) ?? [],
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  }
}
