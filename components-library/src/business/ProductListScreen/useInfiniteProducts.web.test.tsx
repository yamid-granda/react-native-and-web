import { describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import type { ProductsPage } from "../../types/Product"
import { useInfiniteProducts } from "./useInfiniteProducts"

function page(page: number, hasNextPage: boolean): ProductsPage {
  return {
    items: [{ id: `${page}`, title: `Product ${page}`, price: 10, stock: 10 }],
    page,
    limit: 1,
    total: 2,
    hasNextPage,
  }
}

function renderWithClient(
  fetchProducts: (page: number, query?: string) => Promise<ProductsPage>,
  query?: string,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useInfiniteProducts(fetchProducts, query), {
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

  it("forwards the query to fetchProducts and resets pagination under a new cache key", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, false)))
    const { result, rerender } = renderHook(
      ({ query }: { query?: string }) => useInfiniteProducts(fetchProducts, query),
      {
        initialProps: { query: undefined as string | undefined },
        wrapper: ({ children }) => (
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            {children}
          </QueryClientProvider>
        ),
      },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(fetchProducts).toHaveBeenCalledWith(1, undefined)

    fetchProducts.mockClear()
    rerender({ query: "keyboard" })

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(1, "keyboard"))
  })
})
