import { useInfiniteQuery } from "@tanstack/react-query"
import type { ProductsPage } from "../../types/Product"
import { PRODUCTS_KEY } from "../StoreScreen/useMyStoreProducts"

/**
 * The catalogue fetcher `useInfiniteProducts` drives. `query` is the shopper's
 * search term, matching `createApi`'s `fetchProducts` — the marketplace list is
 * the only thing that has one.
 */
export type FetchProducts = (page: number, query?: string) => Promise<ProductsPage>

/**
 * The marketplace catalogue, a page at a time.
 *
 * `query` narrows the listing *on the server*, and it is part of the cache key
 * rather than a filter applied to what comes back. Both halves matter:
 *
 * - Filtering the response would still only see the pages loaded so far, which is
 *   the bug this replaced — a product past page one read as "no match" on mobile,
 *   which cannot scroll its way to the next page once a query has collapsed the
 *   list to nothing.
 * - Putting it in the key means each term is its own paginated cache: a new term
 *   starts again at page one, and backspacing to a previous term returns the pages
 *   already fetched for it instead of re-requesting them. It also stays under
 *   `PRODUCTS_KEY`, so a seller write still retires every term's pages.
 */
export function useInfiniteProducts(fetchProducts: FetchProducts, query = "") {
  // Trimmed here rather than at the call site so `" "` and `""` cannot become two
  // caches of the same rows — and so the key a request is filed under is the key
  // the server derives from `q`.
  const search = query.trim()
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: [...PRODUCTS_KEY, search],
    queryFn: ({ pageParam }) => fetchProducts(pageParam, search),
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