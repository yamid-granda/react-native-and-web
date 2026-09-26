import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ProductListScreen } from "./ProductListScreen"

const products = [
  { id: "1", title: "Wireless Headphones", price: 129.99 },
  { id: "2", title: "Mechanical Keyboard", price: 89.5 },
]

describe("ProductListScreen (web, via react-native-web)", () => {
  it("renders a card per product", () => {
    render(<ProductListScreen products={products} />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Mechanical Keyboard")).toBeInTheDocument()
  })

  it("shows a loading state", () => {
    render(<ProductListScreen products={[]} isLoading />)
    expect(screen.getByText("Loading products…")).toBeInTheDocument()
  })

  it("shows an error state", () => {
    render(<ProductListScreen products={[]} error={new Error("Failed to load products")} />)
    expect(screen.getByText("Error: Failed to load products")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<ProductListScreen products={[]} />)
    expect(screen.getByText("No products yet.")).toBeInTheDocument()
  })

  it("calls onSelectProduct with the product id when a card is clicked", () => {
    const onSelectProduct = vi.fn()
    render(<ProductListScreen products={products} onSelectProduct={onSelectProduct} />)
    fireEvent.click(screen.getByText("Wireless Headphones"))
    expect(onSelectProduct).toHaveBeenCalledWith("1")
  })
})
