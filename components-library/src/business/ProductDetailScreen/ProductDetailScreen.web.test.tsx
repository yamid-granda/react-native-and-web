import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProductDetailScreen } from "./ProductDetailScreen"
import { useCartStore } from "../CartScreen/useCartStore"
import { useRecentlyViewedStore } from "./useRecentlyViewedStore"

const product = {
  id: "1",
  title: "Wireless Headphones",
  description: "Noise-cancelling over-ear headphones.",
  price: 129.99,
}

describe("ProductDetailScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
    useRecentlyViewedStore.setState({ items: [] })
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
    expect(useCartStore.getState().items["1"]).toEqual({ product, quantity: 1 })
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

  it("records the product as recently viewed once it loads, and only once across re-renders", () => {
    const recordView = vi.fn(useRecentlyViewedStore.getState().recordView)
    useRecentlyViewedStore.setState({ recordView })
    const { rerender } = render(<ProductDetailScreen product={product} />)
    rerender(<ProductDetailScreen product={product} />)
    expect(recordView).toHaveBeenCalledTimes(1)
    expect(useRecentlyViewedStore.getState().items).toEqual([product])
  })

  it("does not record a view while loading or when the product is not found", () => {
    render(<ProductDetailScreen isLoading />)
    render(<ProductDetailScreen product={null} />)
    expect(useRecentlyViewedStore.getState().items).toEqual([])
  })
})
