import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProductDetailScreen } from "./ProductDetailScreen"
import { useCartStore } from "../CartScreen/useCartStore"

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
})
