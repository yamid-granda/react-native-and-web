import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useCartStore } from "@rnw/components-library"
import CartPage from "../app/cart/page"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("solito/navigation", () => ({ useRouter: () => ({ push }) }))

describe("CartPage", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
    push.mockClear()
  })

  it("shows an empty state with no items in the cart", () => {
    render(<CartPage />)
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
  })

  it("renders an item added to the cart store", () => {
    useCartStore.getState().addItem({ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 })
    render(<CartPage />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("navigates to /checkout when Proceed to Checkout is clicked", () => {
    useCartStore.getState().addItem({ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 })
    render(<CartPage />)
    fireEvent.click(screen.getByText("Proceed to Checkout"))
    expect(push).toHaveBeenCalledWith("/checkout")
  })
})
