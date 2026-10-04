import { useInfiniteQuery } from "@tanstack/react-query"
import type { ProductsPage } from "../../types/Product"
import { PRODUCTS_KEY } from "../StoreScreen/useMyStoreProducts"

export function useInfiniteProducts(fetchProducts: (page: number) => Promise<ProductsPage>) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ pageParam }) => fetchProducts(pageParam),
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
