import { beforeEach, describe, expect, it } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ProductData } from "../../types/Product"
import type { FetchProductsByIds } from "../ProductLookup/useProductLookup"
import { WishlistScreen } from "./WishlistScreen"
import { useWishlistStore } from "./useWishlistStore"
import { useCartStore } from "../CartScreen/useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }

const catalog = (...products: ProductData[]): FetchProductsByIds => async (ids) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

function renderWishlist(fetchProductsByIds: FetchProductsByIds) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <WishlistScreen fetchProductsByIds={fetchProductsByIds} />
    </QueryClientProvider>,
  )
}

describe("WishlistScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useWishlistStore.setState({ ids: [] })
    useCartStore.setState({ items: {} })
  })

  it("shows an empty state", async () => {
    renderWishlist(catalog(product))
    await waitFor(() =>
      expect(screen.getByText("Your wishlist is empty.")).toBeInTheDocument(),
    )
  })

  it("renders a wishlisted product with its resolved price", async () => {
    useWishlistStore.getState().toggleItem(product.id)
    renderWishlist(catalog(product))

    await waitFor(() => expect(screen.getByText("Wireless Headphones")).toBeInTheDocument())
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("shows the price the server returned, so a wishlisted price can move", async () => {
    useWishlistStore.getState().toggleItem(product.id)
    renderWishlist(catalog({ ...product, price: 999 }))

    await waitFor(() => expect(screen.getByText("$999.00")).toBeInTheDocument())
    expect(screen.queryByText("$129.99")).not.toBeInTheDocument()
  })

  it("says a deleted saved item is unavailable and offers to remove it", async () => {
    useWishlistStore.getState().toggleItem(product.id)
    useWishlistStore.getState().toggleItem("gone")
    renderWishlist(catalog(product))

    await waitFor(() => expect(screen.getByTestId("wishlist-missing")).toHaveTextContent(
      "1 saved item is no longer available.",
    ))
    // The item it can resolve still renders.
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Remove unavailable items"))
    await waitFor(() => expect(screen.queryByTestId("wishlist-missing")).not.toBeInTheDocument())
    expect(useWishlistStore.getState().ids).toEqual(["1"])
  })

  it("reports a failing lookup rather than rendering an empty wishlist", async () => {
    useWishlistStore.getState().toggleItem(product.id)
    renderWishlist(async () => {
      throw new Error("service unavailable")
    })

    await waitFor(() =>
      expect(screen.getByText("Error: service unavailable")).toBeInTheDocument(),
    )
    expect(screen.queryByText("Your wishlist is empty.")).not.toBeInTheDocument()
  })

  it("removes the item when Remove is clicked", async () => {
    useWishlistStore.getState().toggleItem(product.id)
    renderWishlist(catalog(product))
    await waitFor(() => expect(screen.getByText("Wireless Headphones")).toBeInTheDocument())

    fireEvent.click(screen.getByLabelText("Remove Wireless Headphones from wishlist"))
    await waitFor(() =>
      expect(screen.getByText("Your wishlist is empty.")).toBeInTheDocument(),
    )
  })

  /// The data-flow bug: "Add to Cart" used to copy the wishlist's own snapshot
  /// into the cart, so a product wishlisted at $10 landed in the cart at $10
  /// however much it now costs. It now carries only the id, and the cart resolves
  /// it like anything else.
  it("adds only the id to the cart, so the cart resolves the price itself", async () => {
    useWishlistStore.getState().toggleItem(product.id)
    renderWishlist(catalog({ ...product, price: 999 }))
    await waitFor(() => expect(screen.getByText("Add to Cart")).toBeInTheDocument())

    fireEvent.click(screen.getByText("Add to Cart"))
    expect(useCartStore.getState().items["1"]).toEqual({ id: "1", quantity: 1 })
  })
})
