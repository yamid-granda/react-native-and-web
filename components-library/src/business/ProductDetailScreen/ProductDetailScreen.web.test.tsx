import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProductDetailScreen } from "./ProductDetailScreen"

const product = {
  id: "1",
  title: "Wireless Headphones",
  description: "Noise-cancelling over-ear headphones.",
  price: 129.99,
}

describe("ProductDetailScreen (web, via react-native-web)", () => {
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
})
