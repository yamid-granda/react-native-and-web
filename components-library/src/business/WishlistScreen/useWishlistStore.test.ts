import { beforeEach, describe, expect, it } from "vitest"
import { getWishlistTotalCount, isWishlisted, useWishlistStore } from "./useWishlistStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5 }

describe("useWishlistStore", () => {
  beforeEach(() => {
    useWishlistStore.setState({ items: {} })
  })

  it("toggleItem adds a product that isn't in the wishlist yet", () => {
    useWishlistStore.getState().toggleItem(product)
    expect(useWishlistStore.getState().items["1"]).toEqual(product)
  })

  it("toggleItem removes a product that's already in the wishlist", () => {
    useWishlistStore.getState().toggleItem(product)
    useWishlistStore.getState().toggleItem(product)
    expect(useWishlistStore.getState().items["1"]).toBeUndefined()
  })

  it("removeItem removes the item", () => {
    useWishlistStore.getState().toggleItem(product)
    useWishlistStore.getState().removeItem("1")
    expect(useWishlistStore.getState().items["1"]).toBeUndefined()
  })

  it("isWishlisted reflects whether an id is in the items map", () => {
    useWishlistStore.getState().toggleItem(product)
    expect(isWishlisted(useWishlistStore.getState().items, "1")).toBe(true)
    expect(isWishlisted(useWishlistStore.getState().items, "2")).toBe(false)
  })

  it("getWishlistTotalCount counts the number of wishlisted products", () => {
    useWishlistStore.getState().toggleItem(product)
    useWishlistStore.getState().toggleItem(otherProduct)
    expect(getWishlistTotalCount(useWishlistStore.getState().items)).toBe(2)
  })
})
