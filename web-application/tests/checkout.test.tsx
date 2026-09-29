import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { useCartStore } from "@rnw/components-library"
import CheckoutPage from "../app/checkout/page"

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock("solito/navigation", () => ({ useRouter: () => ({ push }) }))

describe("CheckoutPage", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
    push.mockClear()
  })

  it("shows the empty-cart guard and navigates to /cart", () => {
    render(<CheckoutPage />)

    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Go to Cart"))
    expect(push).toHaveBeenCalledWith("/cart")
  })

  it("renders the order summary for a seeded cart", () => {
    useCartStore.getState().addItem({ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 })
    render(<CheckoutPage />)

    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("places the order then navigates to /marketplace on Continue Shopping", () => {
    useCartStore.getState().addItem({ id: "prod-1", title: "Wireless Headphones", price: 129.99, stock: 10 })
    render(<CheckoutPage />)

    fireEvent.click(screen.getByText("Place Order"))
    expect(screen.getByText("Order placed!")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Continue Shopping"))
    expect(push).toHaveBeenCalledWith("/marketplace")
  })
})
