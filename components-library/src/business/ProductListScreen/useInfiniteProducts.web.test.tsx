import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ProductsPage } from "../../types/Product"
import { useInfiniteProducts, type FetchProductsWithQuery } from "./useInfiniteProducts"

function page(page: number, hasNextPage: boolean): ProductsPage {
  return {
    items: [{ id: `${page}`, title: `Product ${page}`, price: 10, stock: 10 }],
    page,
    limit: 1,
    total: 2,
    hasNextPage,
  }
}

function renderWithClient(fetchProducts: FetchProductsWithQuery) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useInfiniteProducts(fetchProducts), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
}

describe("useInfiniteProducts", () => {
  it("fetches the first page and flattens it into products", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, true)))
    const { result } = renderWithClient(fetchProducts)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchProducts).toHaveBeenCalledWith(1, undefined)
    expect(result.current.products).toEqual(page(1, true).items)
    expect(result.current.hasNextPage).toBe(true)
  })

  it("fetches the next page by incrementing from the last page's page number", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, p < 2)))
    const { result } = renderWithClient(fetchProducts)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.fetchNextPage()

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(2, undefined))
    await waitFor(() =>
      expect(result.current.products).toEqual([...page(1, true).items, ...page(2, false).items]),
    )
    expect(result.current.hasNextPage).toBe(false)
  })

  it("uses a server-provided first page without fetching it again", () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, false)))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    const { result } = renderHook(() => useInfiniteProducts(fetchProducts, page(1, true)), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    })

    expect(result.current.isLoading).toBe(false)
    expect(result.current.products).toEqual(page(1, true).items)
    expect(result.current.hasNextPage).toBe(true)
    expect(fetchProducts).not.toHaveBeenCalled()
  })

  it("forwards the active query to the server on every page fetch", async () => {
    const fetchProducts = vi.fn((p: number, _q?: string) =>
      Promise.resolve(page(p, p < 2)),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result, rerender } = renderHook(
      ({ q }: { q?: string }) => useInfiniteProducts(fetchProducts, undefined, q),
      {
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
        initialProps: { q: "blusa" },
      },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(fetchProducts).toHaveBeenLastCalledWith(1, "blusa")

    result.current.fetchNextPage()

    await waitFor(() => expect(fetchProducts).toHaveBeenLastCalledWith(2, "blusa"))

    rerender({ q: "keyboard" })

    await waitFor(() =>
      expect(fetchProducts).toHaveBeenLastCalledWith(1, "keyboard"),
    )
  })

  it("drops the SSR'd first page when a non-empty q is set", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, false)))
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    })
    const { result } = renderHook(
      ({ q }: { q?: string }) => useInfiniteProducts(fetchProducts, page(1, true), q),
      {
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
        initialProps: { q: "blusa" },
      },
    )

    // The seed belongs to the empty-q list, not a search; React Query fires a
    // fresh fetch under the q-keyed cache slot and once it resolves the
    // shopper sees only those rows. Crucially, the SSR'd page 1 of the
    // unfiltered list never appears in `products` — it has its own cache
    // slot, and is not seeded into this one.
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(fetchProducts).toHaveBeenLastCalledWith(1, "blusa")
    expect(result.current.products).toEqual(page(1, false).items)
  })

  it("normalises whitespace-only q to the empty cache slot", async () => {
    const fetchProducts = vi.fn((p: number, _q?: string) =>
      Promise.resolve(page(p, true)),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      ({ q }: { q?: string }) => useInfiniteProducts(fetchProducts, undefined, q),
      {
        wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
        initialProps: { q: "   " },
      },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // Whitespace-only is treated as "no search": the fetcher sees `undefined`,
    // not the original string, so a cache key collision with the empty-q slot
    // never widens into a separate paginated cache.
    expect(fetchProducts).toHaveBeenLastCalledWith(1, undefined)
  })
})
