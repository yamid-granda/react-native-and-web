import { Suspense, act } from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import ProductDetailPage from "../app/marketplace/[id]/page"
import { fetchProduct } from "../lib/api"

vi.mock("../lib/api")

describe("ProductDetailPage", () => {
  it("renders the fetched product", async () => {
    vi.mocked(fetchProduct).mockResolvedValue({
      id: "prod-1",
      title: "Wireless Headphones",
      price: 129.99,
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const paramsPromise = Promise.resolve({ id: "prod-1" })

    // `use(params)` suspends on the first render; the retry that follows once
    // the promise settles only commits if it's driven from inside the same
    // act() batch as the initial render (a plain `render()` + `waitFor()`
    // leaves the retry stuck showing the Suspense fallback forever).
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <Suspense fallback={null}>
            <ProductDetailPage params={paramsPromise} searchParams={Promise.resolve({})} />
          </Suspense>
        </QueryClientProvider>,
      )
      await paramsPromise
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    })
    expect(fetchProduct).toHaveBeenCalledWith("prod-1")
  })
})
