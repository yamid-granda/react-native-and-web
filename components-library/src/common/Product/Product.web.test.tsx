import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Product } from "./Product"
import { useWishlistStore } from "../../business/WishlistScreen/useWishlistStore"

describe("Product (web, via react-native-web)", () => {
  const props = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }

  beforeEach(() => {
    useWishlistStore.setState({ items: {} })
  })

  it("renders the title and formatted price", () => {
    render(<Product {...props} />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("renders the description when provided", () => {
    render(<Product {...props} description="Great sound" />)
    expect(screen.getByText("Great sound")).toBeInTheDocument()
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<Product {...props} onPress={onPress} />)
    fireEvent.click(screen.getByText("Wireless Headphones"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("exposes a testID keyed by product id, for e2e targeting", () => {
    render(<Product {...props} />)
    expect(screen.getByTestId("product-card-1")).toBeInTheDocument()
  })

  it("does not show an out-of-stock badge when stock is available", () => {
    render(<Product {...props} stock={5} />)
    expect(screen.queryByText("Out of stock")).not.toBeInTheDocument()
  })

  it("shows an out-of-stock badge when stock is zero", () => {
    render(<Product {...props} stock={0} />)
    expect(screen.getByText("Out of stock")).toBeInTheDocument()
  })

  it("toggles the wishlist state when the heart toggle is pressed", () => {
    render(<Product {...props} />)
    expect(screen.getByLabelText("Add Wireless Headphones to wishlist")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Add Wireless Headphones to wishlist"))
    expect(useWishlistStore.getState().items["1"]).toEqual({ ...props, currency: "USD" })
    expect(screen.getByLabelText("Remove Wireless Headphones from wishlist")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("Remove Wireless Headphones from wishlist"))
    expect(useWishlistStore.getState().items["1"]).toBeUndefined()
  })

  it("does not trigger onPress (card navigation) when the wishlist toggle is pressed", () => {
    const onPress = vi.fn()
    render(<Product {...props} onPress={onPress} />)
    fireEvent.click(screen.getByLabelText("Add Wireless Headphones to wishlist"))
    expect(onPress).not.toHaveBeenCalled()
  })
})
