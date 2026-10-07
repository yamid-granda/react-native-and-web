import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ProductData } from "../../types/Product"
import type { FetchProductsByIds } from "../ProductLookup/useProductLookup"
import { ProductListScreen, type ProductListScreenProps } from "./ProductListScreen"
import { useRecentlyViewedStore } from "../ProductDetailScreen/useRecentlyViewedStore"

const headphones: ProductData = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }
const keyboard: ProductData = { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 }
const products = [headphones, keyboard]

let intersectionCallback:
  | ((entries: Pick<IntersectionObserverEntry, "isIntersecting">[]) => void)
  | undefined

beforeEach(() => {
  intersectionCallback = undefined
  useRecentlyViewedStore.setState({ ids: [] })
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

function intersectSentinel() {
  intersectionCallback?.([{ isIntersecting: true }])
}

/** The rail resolves remembered ids, so the screen needs a fetcher like the rest. */
const fetchProductsByIds: FetchProductsByIds = async (ids) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

function renderList(props: Omit<ProductListScreenProps, "fetchProductsByIds">) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ProductListScreen {...props} fetchProductsByIds={fetchProductsByIds} />
    </QueryClientProvider>,
  )
}

describe("ProductListScreen (web, via react-native-web)", () => {
  it("renders a card per product", () => {
    renderList({ products })
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Mechanical Keyboard")).toBeInTheDocument()
  })

  // Same shared `ScreenHeader` the cart and wishlist use, so the title clears
  // the status bar without this screen restating the safe-area math.
  it("renders the screen title via ScreenHeader", () => {
    renderList({ products })
    expect(screen.getByTestId("marketplace-title")).toBeInTheDocument()
    expect(screen.getByText("Marketplace")).toBeInTheDocument()
  })

  it("shows a loading state", () => {
    renderList({ products: [], isLoading: true })
    expect(screen.getByText("Loading products…")).toBeInTheDocument()
  })

  it("shows an error state", () => {
    renderList({ products: [], error: new Error("Failed to load products") })
    expect(screen.getByText("Error: Failed to load products")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    renderList({ products: [] })
    expect(screen.getByText("No products yet.")).toBeInTheDocument()
  })

  it("calls onSelectProduct with the product id when a card is clicked", () => {
    const onSelectProduct = vi.fn()
    renderList({ products, onSelectProduct })
    fireEvent.click(screen.getByText("Wireless Headphones"))
    expect(onSelectProduct).toHaveBeenCalledWith("1")
  })

  it("filters products by the search query", () => {
    renderList({ products })
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "keyboard" } })
    expect(screen.getByText("Mechanical Keyboard")).toBeInTheDocument()
    expect(screen.queryByText("Wireless Headphones")).not.toBeInTheDocument()
  })

  it("emits the active query to the page through onQueryChange", async () => {
    const onQueryChange = vi.fn()
    renderList({ products, onQueryChange })

    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "keyboard" } })

    // `useDeferredValue` keeps the input responsive while the filter still
    // settles; the page sees the same string on the next render pass.
    await waitFor(() => expect(onQueryChange).toHaveBeenLastCalledWith("keyboard"))
  })

  it("shows a no-match message when the search query matches nothing", () => {
    renderList({ products })
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "nonexistent" } })
    expect(screen.getByText('No products match "nonexistent".')).toBeInTheDocument()
  })

  it("calls onEndReached when the sentinel intersects and more pages are available", () => {
    const onEndReached = vi.fn()
    renderList({ products, hasNextPage: true, onEndReached })
    intersectSentinel()
    expect(onEndReached).toHaveBeenCalled()
  })

  it("does not call onEndReached when there is no next page", () => {
    const onEndReached = vi.fn()
    renderList({ products, hasNextPage: false, onEndReached })
    expect(intersectionCallback).toBeUndefined()
    expect(onEndReached).not.toHaveBeenCalled()
  })

  it("does not call onEndReached while a page is already being fetched", () => {
    const onEndReached = vi.fn()
    renderList({ products, hasNextPage: true, isFetchingNextPage: true, onEndReached })
    expect(intersectionCallback).toBeUndefined()
    expect(onEndReached).not.toHaveBeenCalled()
  })

  it("shows a loading-more indicator while fetching the next page", () => {
    renderList({ products, isFetchingNextPage: true })
    expect(screen.getByText("Loading more…")).toBeInTheDocument()
  })

  it("does not show a recently-viewed rail when the store is empty", () => {
    renderList({ products })
    expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument()
  })

  /// The rail's cards used to come out of localStorage, so this rail could show
  /// last month's price directly above this month's grid. It now resolves the
  /// same way the grid does, which is why the rail appears only once the lookup
  /// has answered.
  it("resolves the recently-viewed rail rather than rendering a stored snapshot", async () => {
    useRecentlyViewedStore.setState({ ids: ["2"] })
    renderList({ products })

    await waitFor(() => expect(screen.getByText("Recently viewed")).toBeInTheDocument())
    expect(screen.getAllByText("Mechanical Keyboard")).toHaveLength(2)
  })

  it("drops a remembered id the server no longer returns", async () => {
    useRecentlyViewedStore.setState({ ids: ["gone"] })
    renderList({ products })

    await waitFor(() => expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument())
  })

  it("hides the recently-viewed rail while a search query is active", () => {
    useRecentlyViewedStore.setState({ ids: ["2"] })
    renderList({ products })
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "headphones" } })
    expect(screen.queryByText("Recently viewed")).not.toBeInTheDocument()
  })

  it("reorders cards when a sort option is selected", () => {
    renderList({ products })
    fireEvent.click(screen.getByLabelText("Sort by Price: Low to High"))
    const titles = screen.getAllByText(/Headphones|Keyboard/).map((el) => el.textContent)
    expect(titles).toEqual(["Mechanical Keyboard", "Wireless Headphones"])
  })

  it("hides out-of-range products when a price range is set", () => {
    renderList({ products })
    fireEvent.change(screen.getByLabelText("Minimum price"), { target: { value: "100" } })
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.queryByText("Mechanical Keyboard")).not.toBeInTheDocument()
  })

  it("shows a price-range-specific empty state when the range excludes everything", () => {
    renderList({ products })
    fireEvent.change(screen.getByLabelText("Minimum price"), { target: { value: "1000" } })
    expect(screen.getByText("No products match this price range.")).toBeInTheDocument()
  })

  it("shows a combined empty state when both a query and a price range exclude everything", () => {
    renderList({ products })
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "keyboard" } })
    fireEvent.change(screen.getByLabelText("Minimum price"), { target: { value: "1000" } })
    expect(
      screen.getByText('No products match "keyboard" in this price range.'),
    ).toBeInTheDocument()
  })
})
