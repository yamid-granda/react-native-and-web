import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ProductData } from "../../types/Product"

/**
 * What `GET /products/by-ids` answers: the products the server still has, and
 * the ids it no longer has.
 *
 * `missing` is a result, not a failure. A persisted store holds ids a shopper
 * remembered, and a product a seller has since deleted has to be *reportable*
 * for that store to ever drop it — otherwise a deleted line is totalled forever.
 */
export type ProductsByIds = { items: ProductData[]; missing: string[] }

/**
 * The api surface this hook needs, injected by the app that owns the session.
 *
 * Still injected rather than imported, but no longer because the transport is
 * per-app: components-library owns it once (`api/transport.ts`) and each app
 * supplies only what is genuinely its own — a `baseUrl` and `getSessionToken` —
 * to `createApi`. Same rule as `MyStoreApi` and `useInfiniteProducts`.
 */
export type FetchProductsByIds = (ids: string[], signal?: AbortSignal) => Promise<ProductsByIds>

/**
 * The cache key for one batch of remembered ids.
 *
 * Sorted, because the same set asked for in a different order is the same
 * answer: without it, adding a product to the cart and then removing it would
 * leave `["a","b"]` and `["b","a"]` as two entries holding identical data.
 */
export function productLookupKey(ids: string[]) {
  return ["products", "by-ids", [...ids].sort()] as const
}

/**
 * Resolve remembered product ids to live products, in one batched query.
 *
 * The persisted stores keep ids, not snapshots. A stored price is a price nobody
 * has checked since the day it was written, and it is that stored price the cart
 * total, the wishlist and the recently-viewed rail all used to render from — so
 * a seller raising a price left every one of them showing the old figure with no
 * mechanism to ever update it. Everything that renders a remembered product goes
 * through here, which is also why one query serves a whole list and the screens
 * need no data props.
 *
 * **`staleTime: 0`, deliberately not the app's five-minute catalog default.**
 * That default is right for a catalogue — the same page refetched in five
 * minutes is very unlikely to have changed — and exactly wrong for a remembered
 * product: the entire point of the lookup is to notice that a remembered price
 * moved. Spelled out here rather than left to be rediscovered.
 *
 * **One query, not N.** The fetcher takes the whole list because the API has a
 * batched endpoint for it (`GET /products/by-ids`), and the server resolves the
 * whole set in one query as well as one request; fanning out to
 * `GET /products/{id}` per id would be N requests *and* N queries for an N-item
 * cart, and would make a cart with ten lines unusable on a slow connection. The
 * guarantee is the store's, not just the transport's: nothing about it survives
 * a client-side change to this hook, so the shortest way to resolve several ids
 * is still to ask for them all at once.
 *
 * **No offline story.** If the lookup fails, `error` is set and the caller says
 * so. It does not fall back to anything remembered, because there is nothing
 * remembered any more — that is the change this hook exists to make.
 */
export function useProductLookup(ids: string[], fetchProductsByIds: FetchProductsByIds) {
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: productLookupKey(ids),
    queryFn: ({ signal }) => fetchProductsByIds(ids, signal),
    // Nothing to look up is not a pending query: an empty cart must render its
    // empty state, not sit on a spinner that can never resolve.
    enabled: ids.length > 0,
    staleTime: 0,
  })

  // Keyed once per resolved batch rather than rebuilt per render, so the screens
  // can pass it down without defeating the `memo` on every product card.
  const byId = useMemo(() => {
    const map: Record<string, ProductData> = {}
    for (const product of data?.items ?? []) map[product.id] = product
    return map
  }, [data])

  return {
    byId,
    /** Ids the server no longer returns. Reported, never swallowed. */
    missing: data?.missing ?? [],
    isLoading: ids.length > 0 && isPending,
    isFetching,
    error: error ?? null,
  }
}
