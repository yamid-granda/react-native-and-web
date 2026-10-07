import { useInfiniteQuery } from "@tanstack/react-query"
import type { ProductsPage } from "../../types/Product"
import { PRODUCTS_KEY } from "../StoreScreen/useMyStoreProducts"

export function useInfiniteProducts(
  fetchProducts: (page: number) => Promise<ProductsPage>,
  /**
   * A first page already fetched on the server, for the web app's
   * server-rendered marketplace. Seeding it here means the server HTML and the
   * hydrated list agree without a duplicate client fetch; native omits it.
   */
  initialPage?: ProductsPage,
) {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: PRODUCTS_KEY,
    queryFn: ({ pageParam }) => fetchProducts(pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
    initialData: initialPage ? { pages: [initialPage], pageParams: [initialPage.page] } : undefined,
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
