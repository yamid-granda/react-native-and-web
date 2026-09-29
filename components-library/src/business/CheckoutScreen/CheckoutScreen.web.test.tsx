import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CheckoutScreen } from "./CheckoutScreen"
import { useCartStore } from "../CartScreen/useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }

describe("CheckoutScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("shows an empty-cart guard and calls onGoToCart", () => {
    const onGoToCart = vi.fn()
    render(<CheckoutScreen onGoToCart={onGoToCart} />)

    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
    fireEvent.click(screen.getByText("Go to Cart"))
    expect(onGoToCart).toHaveBeenCalled()
  })

  it("renders an order summary with the cart's items and total", () => {
    useCartStore.getState().addItem(product)
    render(<CheckoutScreen />)

    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("clears the cart and shows a confirmation when Place Order is clicked", () => {
    useCartStore.getState().addItem(product)
    render(<CheckoutScreen />)

    fireEvent.click(screen.getByText("Place Order"))

    expect(screen.getByText("Order placed!")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
    expect(useCartStore.getState().items).toEqual({})
  })

  it("calls onContinueShopping after placing an order", () => {
    useCartStore.getState().addItem(product)
    const onContinueShopping = vi.fn()
    render(<CheckoutScreen onContinueShopping={onContinueShopping} />)

    fireEvent.click(screen.getByText("Place Order"))
    fireEvent.click(screen.getByText("Continue Shopping"))

    expect(onContinueShopping).toHaveBeenCalled()
  })
})
