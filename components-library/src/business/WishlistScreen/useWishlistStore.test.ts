import { beforeEach, describe, expect, it } from "vitest"
import { getWishlistTotalCount, isWishlisted, useWishlistStore } from "./useWishlistStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 }

describe("useWishlistStore", () => {
  beforeEach(() => {
    useWishlistStore.setState({ ids: [] })
  })

  it("toggleItem adds an id that isn't in the wishlist yet", () => {
    useWishlistStore.getState().toggleItem(product.id)
    expect(useWishlistStore.getState().ids).toEqual(["1"])
  })

  it("persists ids only, so a wishlisted price cannot go stale in storage", () => {
    useWishlistStore.getState().toggleItem(product.id)
    expect(useWishlistStore.getState().ids).toEqual(["1"])
  })

  it("toggleItem removes an id that's already in the wishlist", () => {
    useWishlistStore.getState().toggleItem(product.id)
    useWishlistStore.getState().toggleItem(product.id)
    expect(useWishlistStore.getState().ids).toEqual([])
  })

  it("keeps insertion order, so the list reads the way it was built", () => {
    useWishlistStore.getState().toggleItem(product.id)
    useWishlistStore.getState().toggleItem(otherProduct.id)
    expect(useWishlistStore.getState().ids).toEqual(["1", "2"])
  })

  it("removeItem removes the id", () => {
    useWishlistStore.getState().toggleItem(product.id)
    useWishlistStore.getState().toggleItem(otherProduct.id)
    useWishlistStore.getState().removeItem("1")
    expect(useWishlistStore.getState().ids).toEqual(["2"])
  })

  it("removeItem is a no-op for an id that was never wishlisted", () => {
    useWishlistStore.getState().toggleItem(product.id)
    useWishlistStore.getState().removeItem("nobody")
    expect(useWishlistStore.getState().ids).toEqual(["1"])
  })

  it("isWishlisted reflects whether an id is in the list", () => {
    useWishlistStore.getState().toggleItem(product.id)
    expect(isWishlisted(useWishlistStore.getState().ids, "1")).toBe(true)
    expect(isWishlisted(useWishlistStore.getState().ids, "2")).toBe(false)
  })

  it("getWishlistTotalCount counts the number of wishlisted ids", () => {
    useWishlistStore.getState().toggleItem(product.id)
    useWishlistStore.getState().toggleItem(otherProduct.id)
    expect(getWishlistTotalCount(useWishlistStore.getState().ids)).toBe(2)
  })
})
