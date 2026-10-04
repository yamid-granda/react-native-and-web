import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ProductData } from "../../types/Product"
import { productLookupKey, useProductLookup, type FetchProductsByIds } from "./useProductLookup"

const headphones: ProductData = {
  id: "prod-1",
  title: "Wireless Headphones",
  price: 129.99,
  stock: 10,
}
const keyboard: ProductData = {
  id: "prod-2",
  title: "Mechanical Keyboard",
  price: 89.5,
  stock: 10,
}

/** What the endpoint answers for `ids`: the products it has, the ids it doesn't. */
const catalog = (products: ProductData[]): FetchProductsByIds => async (ids) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

// `retry: false` and no staleTime override: the hook's own policy is the thing
// under test, so the client is left as close to v5's defaults as possible.
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderWithClient(ids: string[], fetchProductsByIds: FetchProductsByIds) {
  return renderHook(() => useProductLookup(ids, fetchProductsByIds), {
    wrapper: wrapperFor(client()),
  })
}

describe("productLookupKey", () => {
  it("is the same key for the same set of ids in any order", () => {
    expect(productLookupKey(["b", "a"])).toEqual(productLookupKey(["a", "b"]))
  })

  it("is a different key for a different set of ids", () => {
    expect(productLookupKey(["a"])).not.toEqual(productLookupKey(["a", "b"]))
  })
})

describe("useProductLookup", () => {
  it("resolves every id in one batched call, keyed by id", async () => {
    const fetchProductsByIds = vi.fn(catalog([headphones, keyboard]))
    const { result } = renderWithClient(["prod-1", "prod-2"], fetchProductsByIds)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchProductsByIds).toHaveBeenCalledTimes(1)
    expect(fetchProductsByIds.mock.calls[0]?.[0]).toEqual(["prod-1", "prod-2"])
    expect(result.current.byId["prod-1"]).toEqual(headphones)
    expect(result.current.byId["prod-2"]).toEqual(keyboard)
    expect(result.current.missing).toEqual([])
  })

  /// The assertion the old reducer could not make. Nothing re-read a product
  /// before, so there was no seam through which a changed price could reach the
  /// cart total — this is the test that seam was added for.
  it("reports the price the fetcher returned, so a raised price reaches the caller", async () => {
    const before = renderWithClient(["prod-1"], catalog([headphones]))
    await waitFor(() => expect(before.result.current.byId["prod-1"]?.price).toBe(129.99))

    const after = renderWithClient(["prod-1"], catalog([{ ...headphones, price: 999 }]))
    await waitFor(() => expect(after.result.current.byId["prod-1"]?.price).toBe(999))
  })

  /// The negative check the proposal asks for, as a positive assertion: with the
  /// app's five-minute catalog `staleTime` the second mount below would reuse the
  /// cached answer and a cart would keep showing last month's price. `staleTime: 0`
  /// makes the entry stale on arrival, so every mount re-reads.
  it("re-reads on a later mount rather than serving the cached answer", async () => {
    const fetchProductsByIds = vi.fn(catalog([headphones]))
    const queryClient = client()
    const wrapper = wrapperFor(queryClient)

    const first = renderHook(() => useProductLookup(["prod-1"], fetchProductsByIds), { wrapper })
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    expect(fetchProductsByIds).toHaveBeenCalledTimes(1)

    renderHook(() => useProductLookup(["prod-1"], fetchProductsByIds), { wrapper })
    await waitFor(() => expect(fetchProductsByIds).toHaveBeenCalledTimes(2))
  })

  it("returns an id the server omits in missing rather than dropping it silently", async () => {
    const { result } = renderWithClient(["prod-1", "gone"], catalog([headphones]))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.byId.gone).toBeUndefined()
    expect(result.current.missing).toEqual(["gone"])
  })

  it("surfaces a failing lookup as an error instead of an empty result", async () => {
    const failing: FetchProductsByIds = async () => {
      throw new Error("service unavailable")
    }
    const { result } = renderWithClient(["prod-1"], failing)

    await waitFor(() => expect(result.current.error?.message).toBe("service unavailable"))

    expect(result.current.byId).toEqual({})
    // Not reported as missing: a lookup that failed has not told us anything
    // about which products still exist.
    expect(result.current.missing).toEqual([])
  })

  it("never calls the fetcher for an empty id list, and is not stuck loading", async () => {
    const fetchProductsByIds = vi.fn(catalog([headphones]))
    const { result } = renderWithClient([], fetchProductsByIds)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchProductsByIds).not.toHaveBeenCalled()
    expect(result.current.byId).toEqual({})
  })

  it("shares one cache entry between callers that ask in different orders", async () => {
    const fetchProductsByIds = vi.fn(catalog([headphones, keyboard]))
    const queryClient = client()
    const wrapper = wrapperFor(queryClient)

    const first = renderHook(() => useProductLookup(["prod-2", "prod-1"], fetchProductsByIds), {
      wrapper,
    })
    await waitFor(() => expect(first.result.current.byId["prod-1"]).toBeDefined())

    const second = renderHook(() => useProductLookup(["prod-1", "prod-2"], fetchProductsByIds), {
      wrapper,
    })
    await waitFor(() => expect(second.result.current.byId["prod-2"]).toBeDefined())

    // One cache entry rather than two holding identical data for the same two
    // products — and readable under either ordering of the same ids.
    //
    // Asserted on the cache, deliberately not on the fetch count: `staleTime: 0`
    // means a newly mounted observer refetches *on purpose*, because noticing
    // that a remembered price has moved is the entire point of this hook. A
    // second fetch is therefore correct behaviour, and counting fetches would
    // quietly assert against the policy every test above depends on.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
    expect(queryClient.getQueryData(productLookupKey(["prod-1", "prod-2"]))).toEqual({
      items: [headphones, keyboard],
      missing: [],
    })
  })
})
