import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProductDetailScreen } from "./ProductDetailScreen"
import { useCartStore } from "../CartScreen/useCartStore"
import { useRecentlyViewedStore } from "./useRecentlyViewedStore"
import { useWishlistStore } from "../WishlistScreen/useWishlistStore"

const product = {
  id: "1",
  title: "Wireless Headphones",
  description: "Noise-cancelling over-ear headphones.",
  price: 129.99,
  stock: 10,
}

describe("ProductDetailScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
    useRecentlyViewedStore.setState({ ids: [] })
    useWishlistStore.setState({ ids: [] })
  })

  it("renders the title, description, and formatted price", () => {
    render(<ProductDetailScreen product={product} />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Noise-cancelling over-ear headphones.")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("shows a loading state", () => {
    render(<ProductDetailScreen isLoading />)
    expect(screen.getByText("Loading product…")).toBeInTheDocument()
  })

  it("shows an error state", () => {
    render(<ProductDetailScreen error={new Error("Failed to load product")} />)
    expect(screen.getByText("Error: Failed to load product")).toBeInTheDocument()
  })

  it("shows a not-found state when there is no product and nothing is loading/erroring", () => {
    render(<ProductDetailScreen product={null} />)
    expect(screen.getByText("Product not found.")).toBeInTheDocument()
  })

  it("adds the product to the cart when Add to Cart is clicked", () => {
    render(<ProductDetailScreen product={product} />)
    fireEvent.click(screen.getByText("Add to Cart"))
    expect(useCartStore.getState().items["1"]).toEqual({ id: "1", quantity: 1 })
  })

  it("shows a confirmation drawer when Add to Cart is clicked", () => {
    render(<ProductDetailScreen product={product} />)
    fireEvent.click(screen.getByText("Add to Cart"))
    expect(screen.getByText("Added to cart")).toBeInTheDocument()
    expect(
      screen.getByText("Wireless Headphones has been added to your cart."),
    ).toBeInTheDocument()
  })

  it("calls onGoToCart when the drawer's Go to Cart button is clicked", () => {
    const onGoToCart = vi.fn()
    render(<ProductDetailScreen product={product} onGoToCart={onGoToCart} />)
    fireEvent.click(screen.getByText("Add to Cart"))
    fireEvent.click(screen.getByText("Go to Cart"))
    expect(onGoToCart).toHaveBeenCalledTimes(1)
  })

  it("shows 'In stock' and an enabled Add to Cart button at healthy stock", () => {
    render(<ProductDetailScreen product={{ ...product, stock: 10 }} />)
    expect(screen.getByText("In stock")).toBeInTheDocument()
    expect(screen.getByText("Add to Cart")).toBeEnabled()
  })

  it("shows 'Only N left' at low stock", () => {
    render(<ProductDetailScreen product={{ ...product, stock: 3 }} />)
    expect(screen.getByText("Only 3 left")).toBeInTheDocument()
  })

  it("disables and relabels Add to Cart at zero stock, and doesn't add it to the cart", () => {
    render(<ProductDetailScreen product={{ ...product, stock: 0 }} />)
    const button = screen.getByRole("button", { name: "Out of stock" })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(useCartStore.getState().items["1"]).toBeUndefined()
  })

  it("records the product as recently viewed once it loads, and only once across re-renders", () => {
    const recordView = vi.fn(useRecentlyViewedStore.getState().recordView)
    useRecentlyViewedStore.setState({ recordView })
    const { rerender } = render(<ProductDetailScreen product={product} />)
    rerender(<ProductDetailScreen product={product} />)
    expect(recordView).toHaveBeenCalledTimes(1)
    expect(useRecentlyViewedStore.getState().ids).toEqual(["1"])
  })

  it("does not record a view while loading or when the product is not found", () => {
    render(<ProductDetailScreen isLoading />)
    render(<ProductDetailScreen product={null} />)
    expect(useRecentlyViewedStore.getState().ids).toEqual([])
  })

  it("toggles the wishlist state when the wishlist button is clicked", () => {
    render(<ProductDetailScreen product={product} />)
    expect(screen.getByLabelText("Add Wireless Headphones to wishlist")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Add Wireless Headphones to wishlist"))
    expect(useWishlistStore.getState().ids).toEqual(["1"])
    expect(screen.getByLabelText("Remove Wireless Headphones from wishlist")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Remove Wireless Headphones from wishlist"))
    expect(useWishlistStore.getState().ids).toEqual([])
  })

  describe("Sold by", () => {
    const sold = { ...product, storeId: "usr_1", storeName: "Riverbend Vintage" }

    it("is absent for a product with no seller", () => {
      render(<ProductDetailScreen product={product} />)
      expect(screen.queryByText(/Sold by/)).not.toBeInTheDocument()
    })

    it("is absent when the wire sends a null store name", () => {
      render(<ProductDetailScreen product={{ ...product, storeId: null, storeName: null }} />)
      expect(screen.queryByText(/Sold by/)).not.toBeInTheDocument()
    })

    it("names the store and opens it on press", () => {
      const onOpenStore = vi.fn()
      render(<ProductDetailScreen product={sold} onOpenStore={onOpenStore} />)
      expect(screen.getByText("Sold by Riverbend Vintage")).toBeInTheDocument()

      fireEvent.click(screen.getByLabelText("Sold by Riverbend Vintage"))
      expect(onOpenStore).toHaveBeenCalledWith("usr_1")
    })

    it("still names the store when there is nowhere to navigate to", () => {
      render(<ProductDetailScreen product={sold} />)
      expect(screen.getByText("Sold by Riverbend Vintage")).toBeInTheDocument()
      // Not focusable: an inert button in the tab order is worse than plain text.
      expect(screen.getByLabelText("Sold by Riverbend Vintage")).toBeDisabled()
    })

    it("does not fire without a store id, even with a handler", () => {
      const onOpenStore = vi.fn()
      render(
        <ProductDetailScreen
          product={{ ...product, storeId: undefined, storeName: "Riverbend Vintage" }}
          onOpenStore={onOpenStore}
        />,
      )
      fireEvent.click(screen.getByLabelText("Sold by Riverbend Vintage"))
      expect(onOpenStore).not.toHaveBeenCalled()
    })
  })
})
