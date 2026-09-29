import { beforeEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { WishlistScreen } from "./WishlistScreen"
import { useWishlistStore } from "./useWishlistStore"
import { useCartStore } from "../CartScreen/useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }

describe("WishlistScreen (web, via react-native-web)", () => {
  beforeEach(() => {
    useWishlistStore.setState({ items: {} })
    useCartStore.setState({ items: {} })
  })

  it("shows an empty state", () => {
    render(<WishlistScreen />)
    expect(screen.getByText("Your wishlist is empty.")).toBeInTheDocument()
  })

  it("renders a wishlisted product with its price", () => {
    useWishlistStore.getState().toggleItem(product)
    render(<WishlistScreen />)
    expect(screen.getByText("Wireless Headphones")).toBeInTheDocument()
    expect(screen.getByText("$129.99")).toBeInTheDocument()
  })

  it("removes the item when Remove is clicked", () => {
    useWishlistStore.getState().toggleItem(product)
    render(<WishlistScreen />)
    fireEvent.click(screen.getByLabelText("Remove Wireless Headphones from wishlist"))
    expect(screen.getByText("Your wishlist is empty.")).toBeInTheDocument()
  })

  it("adds the product to the cart when Add to Cart is clicked", () => {
    useWishlistStore.getState().toggleItem(product)
    render(<WishlistScreen />)
    fireEvent.click(screen.getByText("Add to Cart"))
    expect(useCartStore.getState().items["1"]).toEqual({ product, quantity: 1 })
  })
})
