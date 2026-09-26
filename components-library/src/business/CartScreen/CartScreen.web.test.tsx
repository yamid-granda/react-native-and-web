import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { CartScreen } from "./CartScreen"
import { useCartStore } from "./useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99 }

describe("CartScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("shows an empty state", () => {
    render(<CartScreen />)
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
  })

  it("renders a line item with its quantity and the total price", () => {
    useCartStore.getState().addItem(product)
    render(<CartScreen />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("1")).toBeInTheDocument()
    expect(screen.getByText("Total: $129.99")).toBeInTheDocument()
  })

  it("increases quantity when the + button is pressed", () => {
    useCartStore.getState().addItem(product)
    render(<CartScreen />)
    fireEvent.click(screen.getByLabelText("Increase Wireless Headphones quantity"))
    expect(screen.getByText("2")).toBeInTheDocument()
  })

  it("decreases quantity when the - button is pressed", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().incrementQuantity("1")
    render(<CartScreen />)
    fireEvent.click(screen.getByLabelText("Decrease Wireless Headphones quantity"))
    expect(screen.getByText("1")).toBeInTheDocument()
  })

  it("removes the item when Remove is clicked", () => {
    useCartStore.getState().addItem(product)
    render(<CartScreen />)
    fireEvent.click(screen.getByLabelText("Remove Wireless Headphones from cart"))
    expect(screen.getByText("Your cart is empty.")).toBeInTheDocument()
  })
})
