import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { router } from "expo-router"
import HomeRoute from "../src/app/(tabs)/(home)/index"

// The route pushes imperatively; the mock pins the destination, not the router.
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }))

// expo-constants has no jsdom equivalent — the route only needs the page the
// fetcher returns, so the whole client module is replaced at the boundary.
vi.mock("../src/api/client", () => ({
  fetchProducts: async () => ({
    items: [{ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 }],
    page: 1,
    limit: 20,
    total: 1,
    hasNextPage: false,
  }),
  fetchProductsByIds: async (ids: string[]) => ({ items: [], missing: ids }),
}))

const push = router.push as Mock

let intersectionCallback: ((entries: { isIntersecting: boolean }[]) => void) | undefined

beforeEach(() => {
  push.mockClear()
  intersectionCallback = undefined
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: typeof intersectionCallback) {
        intersectionCallback = callback
      }
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderHome() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <HomeRoute />
    </QueryClientProvider>,
  )
}

describe("HomeRoute (marketplace → product detail)", () => {
  it("pushes the product detail route when a marketplace card is pressed", async () => {
    renderHome()

    fireEvent.click(await screen.findByText("Wireless Headphones"))

    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ pathname: "/product/[id]", params: { id: "prod-1" } })
  })

  it("does not navigate without a press", async () => {
    renderHome()

    await screen.findByText("Wireless Headphones")

    expect(push).not.toHaveBeenCalled()
  })
})
