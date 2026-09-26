import { beforeEach, describe, expect, it } from "vitest"
import { getCartTotalCount, getCartTotalPrice, useCartStore } from "./useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5 }

describe("useCartStore", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("addItem adds a new item with quantity 1", () => {
    useCartStore.getState().addItem(product)
    expect(useCartStore.getState().items["1"]).toEqual({ product, quantity: 1 })
  })

  it("addItem increments quantity when the product is already in the cart", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().addItem(product)
    expect(useCartStore.getState().items["1"]?.quantity).toBe(2)
  })

  it("incrementQuantity increases an existing item's quantity", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().incrementQuantity("1")
    expect(useCartStore.getState().items["1"]?.quantity).toBe(2)
  })

  it("decrementQuantity decreases quantity and removes the item at zero", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().incrementQuantity("1")
    useCartStore.getState().decrementQuantity("1")
    expect(useCartStore.getState().items["1"]?.quantity).toBe(1)

    useCartStore.getState().decrementQuantity("1")
    expect(useCartStore.getState().items["1"]).toBeUndefined()
  })

  it("removeItem removes the item regardless of quantity", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().incrementQuantity("1")
    useCartStore.getState().removeItem("1")
    expect(useCartStore.getState().items["1"]).toBeUndefined()
  })

  it("clear empties the cart", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().addItem(otherProduct)
    useCartStore.getState().clear()
    expect(useCartStore.getState().items).toEqual({})
  })

  it("getCartTotalCount sums quantities across items", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().addItem(otherProduct)
    useCartStore.getState().incrementQuantity("1")
    expect(getCartTotalCount(useCartStore.getState().items)).toBe(3)
  })

  it("getCartTotalPrice sums price * quantity across items", () => {
    useCartStore.getState().addItem(product)
    useCartStore.getState().addItem(otherProduct)
    expect(getCartTotalPrice(useCartStore.getState().items)).toBeCloseTo(219.49)
  })
})
