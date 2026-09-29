import { describe, expect, it } from "vitest"
import { filterAndSortProducts } from "./useProductSearch"

const products = [
  { id: "1", title: "Wireless Headphones", description: "Noise-cancelling", price: 129.99, stock: 10 },
  { id: "2", title: "Mechanical Keyboard", description: "Hot-swappable", price: 89.5, stock: 10 },
  { id: "3", title: "Ceramic Coffee Mug", price: 18, stock: 10 },
]

function filter(overrides: {
  sortBy?: "relevance" | "price-asc" | "price-desc"
  priceRange?: { min?: number; max?: number }
}) {
  return filterAndSortProducts(products, {
    sortBy: overrides.sortBy ?? "relevance",
    priceRange: overrides.priceRange ?? {},
  })
}

describe("filterAndSortProducts", () => {
  it("returns every product when no sort or price range is set", () => {
    expect(filter({}).map((p) => p.id)).toEqual(["1", "2", "3"])
  })

  it("filters by a minimum price, inclusive", () => {
    expect(filter({ priceRange: { min: 89.5 } }).map((p) => p.id)).toEqual(["1", "2"])
  })

  it("filters by a maximum price, inclusive", () => {
    expect(filter({ priceRange: { max: 89.5 } }).map((p) => p.id)).toEqual(["2", "3"])
  })

  it("filters by a min and max price together", () => {
    expect(filter({ priceRange: { min: 20, max: 100 } }).map((p) => p.id)).toEqual(["2"])
  })

  it("sorts by price ascending", () => {
    expect(filter({ sortBy: "price-asc" }).map((p) => p.id)).toEqual(["3", "2", "1"])
  })

  it("sorts by price descending", () => {
    expect(filter({ sortBy: "price-desc" }).map((p) => p.id)).toEqual(["1", "2", "3"])
  })

  it("composes price range and sort together", () => {
    expect(
      filterAndSortProducts(products, { sortBy: "price-asc", priceRange: { max: 100 } }).map(
        (p) => p.id,
      ),
    ).toEqual(["3", "2"])
    expect(filterAndSortProducts(products, { sortBy: "price-asc", priceRange: { max: 10 } })).toEqual(
      [],
    )
  })

  it("returns an empty list when the price range excludes every product", () => {
    expect(filter({ priceRange: { min: 1000 } })).toEqual([])
  })
})
