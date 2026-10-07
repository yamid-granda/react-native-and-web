import { useInfiniteQuery } from "@tanstack/react-query"
import type { ProductsPage } from "../../types/Product"
import { PRODUCTS_KEY } from "../StoreScreen/useMyStoreProducts"

/**
 * Search-shape: whatever the page owns as the "active" search.
 *
 * `string` covers every normal call site — the marketplace's `SearchInput`
 * types into a controlled string. The hook trims it once before passing it on,
 * so an all-whitespace query behaves exactly like an absent one (the unfiltered
 * default) and never becomes its own paginated cache slot.
 */
export type SearchQuery = string | undefined

/**
 * One `q` value per call: a `fetchProducts` whose `(page, q)` pair the server
 * cache keys separately (see `api-rs/src/handlers/products.rs`). The hook
 * forwards `q` on every page fetch so the entire paged window is consistent.
 */
export type FetchProductsWithQuery = (page: number, q?: string) => Promise<ProductsPage>

/**
 * Encode the active query into the React Query key.
 *
 * Same shape as the existing `PRODUCTS_KEY` (an array), so a future migration
 * can keep the existing entries' shape and add `q` without breaking deserialised
 * cache data. Empty / whitespace `q` is normalised to `""` so two callers
 * typing spaces do not get distinct cache slots.
 */
function productsKey(q: SearchQuery): readonly unknown[] {
  return [PRODUCTS_KEY[0], (q ?? "").trim()]
}

export function useInfiniteProducts(
  /**
   * One parameter — the active query. The page owns it, the list screen
   * forwards its debounced value, and the hook passes it on to every page
   * fetch. Same shape both apps already use.
   */
  fetchProducts: FetchProductsWithQuery,
  /**
   * A first page already fetched on the server, for the web app's
   * server-rendered marketplace. Seeding it here means the server HTML and the
   * hydrated list agree without a duplicate client fetch; native omits it.
   *
   * Only meaningful when `q` is empty/whitespace: SSR happens before the user
   * types, so a SSR'd page only applies to the unfiltered query. The page
   * wrapper is the one that knows when to drop it.
   */
  initialPage?: ProductsPage,
  q?: SearchQuery,
) {
  const normalisedQ = (q ?? "").trim()
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: productsKey(normalisedQ),
    queryFn: ({ pageParam }) => fetchProducts(pageParam, normalisedQ || undefined),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
    // Seed only when the SSR'd page matches the current query: a SSR'd page 1
    // of the unfiltered list does not belong to a search, and React Query
    // would otherwise keep answering that page while the network catches up.
    initialData:
      initialPage && !normalisedQ ? { pages: [initialPage], pageParams: [initialPage.page] } : undefined,
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
