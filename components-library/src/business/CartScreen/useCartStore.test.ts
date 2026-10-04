import { beforeEach, describe, expect, it } from "vitest"
import type { ProductData } from "../../types/Product"
import {
  getCartTotalCount,
  getCartTotalPrice,
  useCartStore,
  type ResolvedCartLine,
} from "./useCartStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 }

/** What `useProductLookup` hands the screens: live products, keyed by id. */
const resolved = (products: ProductData[], quantities: number[]): ResolvedCartLine[] =>
  products.map((product, index) => ({ product, quantity: quantities[index] ?? 0 }))

describe("useCartStore", () => {
  beforeEach(() => {
    useCartStore.setState({ items: {} })
  })

  it("addItem adds a new item with quantity 1", () => {
    useCartStore.getState().addItem(product.id)
    expect(useCartStore.getState().items["1"]).toEqual({ id: "1", quantity: 1 })
  })

  it("persists the id and nothing else, so no snapshot can go stale in storage", () => {
    useCartStore.getState().addItem(product.id)
    // The whole point of the shape: a price a seller later changes has nowhere
    // in this store to be wrong.
    expect(Object.keys(useCartStore.getState().items["1"] ?? {}).sort()).toEqual(["id", "quantity"])
  })

  it("addItem increments quantity when the product is already in the cart", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem(product.id)
    expect(useCartStore.getState().items["1"]?.quantity).toBe(2)
  })

  it("incrementQuantity increases an existing item's quantity", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().incrementQuantity("1")
    expect(useCartStore.getState().items["1"]?.quantity).toBe(2)
  })

  it("decrementQuantity decreases quantity and removes the item at zero", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().incrementQuantity("1")
    useCartStore.getState().decrementQuantity("1")
    expect(useCartStore.getState().items["1"]?.quantity).toBe(1)

    useCartStore.getState().decrementQuantity("1")
    expect(useCartStore.getState().items["1"]).toBeUndefined()
  })

  it("ignores a quantity change for an id that is not in the cart", () => {
    useCartStore.getState().incrementQuantity("nobody")
    useCartStore.getState().decrementQuantity("nobody")
    expect(useCartStore.getState().items).toEqual({})
  })

  it("removeItem removes the item regardless of quantity", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().incrementQuantity("1")
    useCartStore.getState().removeItem("1")
    expect(useCartStore.getState().items["1"]).toBeUndefined()
  })

  it("clear empties the cart", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem(otherProduct.id)
    useCartStore.getState().clear()
    expect(useCartStore.getState().items).toEqual({})
  })

  it("getCartTotalCount sums quantities across items", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem(otherProduct.id)
    useCartStore.getState().incrementQuantity("1")
    expect(getCartTotalCount(useCartStore.getState().items)).toBe(3)
  })

  it("getCartTotalPrice sums price * quantity across items", () => {
    useCartStore.getState().addItem(product.id)
    useCartStore.getState().addItem(otherProduct.id)
    const lines = resolved([product, otherProduct], [1, 1])
    expect(getCartTotalPrice(lines)).toBeCloseTo(219.49)
  })

  /// The assertion the old reducer could not make: the total is computed from
  /// the products the lookup returned, so a seller raising a price moves it.
  /// Before the change this took `items` and read `item.product.price` out of
  /// localStorage, which no test could have moved.
  it("getCartTotalPrice follows the resolved price, not the one remembered", () => {
    const raised = { ...product, price: 999 }
    expect(getCartTotalPrice(resolved([product], [2]))).toBeCloseTo(259.98)
    expect(getCartTotalPrice(resolved([raised], [2]))).toBeCloseTo(1998)
  })

  it("getCartTotalPrice totals nothing as zero", () => {
    expect(getCartTotalPrice([])).toBe(0)
  })
})
