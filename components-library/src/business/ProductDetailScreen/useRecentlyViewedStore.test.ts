import { beforeEach, describe, expect, it } from "vitest"
import { useRecentlyViewedStore } from "./useRecentlyViewedStore"

const product = { id: "1", title: "Wireless Headphones", price: 129.99 }
const otherProduct = { id: "2", title: "Mechanical Keyboard", price: 89.5 }

describe("useRecentlyViewedStore", () => {
  beforeEach(() => {
    useRecentlyViewedStore.setState({ items: [] })
  })

  it("recordView adds a product to the front of the list", () => {
    useRecentlyViewedStore.getState().recordView(product)
    expect(useRecentlyViewedStore.getState().items).toEqual([product])
  })

  it("recordView puts the most recently viewed product first", () => {
    useRecentlyViewedStore.getState().recordView(product)
    useRecentlyViewedStore.getState().recordView(otherProduct)
    expect(useRecentlyViewedStore.getState().items).toEqual([otherProduct, product])
  })

  it("recordView moves an already-viewed product to the front instead of duplicating it", () => {
    useRecentlyViewedStore.getState().recordView(product)
    useRecentlyViewedStore.getState().recordView(otherProduct)
    useRecentlyViewedStore.getState().recordView(product)
    expect(useRecentlyViewedStore.getState().items).toEqual([product, otherProduct])
  })

  it("caps the list at 10 entries, dropping the oldest", () => {
    for (let i = 0; i < 11; i++) {
      useRecentlyViewedStore.getState().recordView({ id: String(i), title: `Product ${i}`, price: 1 })
    }
    const items = useRecentlyViewedStore.getState().items
    expect(items).toHaveLength(10)
    expect(items[0]).toEqual({ id: "10", title: "Product 10", price: 1 })
    expect(items.some((item) => item.id === "0")).toBe(false)
  })
})
