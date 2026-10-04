import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Product } from "./Product"

// This file is the web adapter's seam and nothing else: it supplies the
// image, ProductCard.tsx holds everything the two platforms share, and its
// assertions live in ProductCard.web.test.tsx.
describe("Product (web adapter, via react-native-web)", () => {
  const props = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }

  it("renders the product image as an <img> labelled with the title", () => {
    render(<Product {...props} imageUrl="https://example.com/headphones.png" />)
    expect(screen.getByRole("img")).toHaveAttribute("alt", "Wireless Headphones")
  })

  it("renders no image element when the product has no imageUrl", () => {
    render(<Product {...props} />)
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
  })
})