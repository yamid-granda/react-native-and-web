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

function renderWithClient(fetchProducts: (page: number, query?: string) => Promise<ProductsPage>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    client,
    ...renderHook(({ query }: { query?: string }) => useInfiniteProducts(fetchProducts, query), {
      initialProps: { query: "" },
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    }),
  }
}

describe("useInfiniteProducts", () => {
  it("fetches the first page and flattens it into products", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, true)))
    const { result } = renderWithClient(fetchProducts)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // The term is always passed, blank included: the fetcher and the cache key have
    // to agree on what "no search" means, and a caller that has to remember to omit
    // it is how the two drift apart.
    expect(fetchProducts).toHaveBeenCalledWith(1, "")
    expect(result.current.products).toEqual(page(1, true).items)
    expect(result.current.hasNextPage).toBe(true)
  })

  it("fetches the next page by incrementing from the last page's page number", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, p < 2)))
    const { result } = renderWithClient(fetchProducts)

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    result.current.fetchNextPage()

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(2, ""))
    await waitFor(() =>
      expect(result.current.products).toEqual([...page(1, true).items, ...page(2, false).items]),
    )
    expect(result.current.hasNextPage).toBe(false)
  })

  /// The bug this hook was changed for: a search used to filter only the pages
  /// already loaded, so a product past page one was reported as "no match" until
  /// the shopper scrolled to it — and on mobile they then could not, because a
  /// collapsed list is not scrollable. The term has to reach the server.
  it("asks the server for a page narrowed by the term, rather than filtering what it has", async () => {
    const fetchProducts = vi.fn((p: number, query?: string) =>
      Promise.resolve(query ? { ...page(p, false), items: [] } : page(p, true)),
    )
    const { result, rerender } = renderWithClient(fetchProducts)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    rerender({ query: "blusa" })

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(1, "blusa"))
    expect(result.current.products).toEqual([])
  })

  /// A new term is a different listing, not a filter over the current one: the
  /// pages fetched for the old term describe rows that are no longer on screen,
  /// and the new term starts at page one.
  it("restarts at page one under a new cache key when the term changes", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, true)))
    const { result, rerender, client } = renderWithClient(fetchProducts)

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    result.current.fetchNextPage()
    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(2, ""))

    rerender({ query: "bebé" })

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(1, "bebé"))
    expect(result.current.products).toEqual(page(1, true).items)
    // Both listings stay cached, so backspacing to the previous term is free and a
    // seller write can still retire either of them through PRODUCTS_KEY.
    expect(client.getQueryState(["products", ""])).toBeDefined()
    expect(client.getQueryState(["products", "bebé"])).toBeDefined()
  })

  /// `?q=` and no `q` are the same request, so they have to be the same cache key
  /// — otherwise a shopper who clears the box re-fetches the whole catalogue.
  it("treats a blank term as no term", async () => {
    const fetchProducts = vi.fn((p: number) => Promise.resolve(page(p, true)))
    const { rerender, client } = renderWithClient(fetchProducts)

    await waitFor(() => expect(fetchProducts).toHaveBeenCalledWith(1, ""))
    rerender({ query: "   " })

    await waitFor(() => expect(client.getQueryState(["products", ""])).toBeDefined())
    expect(fetchProducts).toHaveBeenCalledTimes(1)
  })
})