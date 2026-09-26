import { beforeEach, describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { useCartStore } from "@rnw/components-library"
import CartPage from "../app/cart/page"

describe("CartPage", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("shows an empty state with no items in the cart", () => {
    render(<CartPage />)
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
  })

  it("renders an item added to the cart store", () => {
    useCartStore.getState().addItem({ id: "prod-1", title: "Wireless Headphones", price: 129.99 })
    render(<CartPage />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })
})
