import { describe, expect, it } from "vitest"
import { filterAndSortProducts } from "./useProductSearch"

const products = [
  { id: "1", title: "Wireless Headphones", description: "Noise-cancelling", price: 129.99, stock: 10 },
  { id: "2", title: "Mechanical Keyboard", description: "Hot-swappable", price: 89.5, stock: 10 },
  { id: "3", title: "Ceramic Coffee Mug", price: 18, stock: 10 },
]

function filter(overrides: {
  query?: string
  sortBy?: "relevance" | "price-asc" | "price-desc"
  priceRange?: { min?: number; max?: number }
}) {
  return filterAndSortProducts(products, {
    query: overrides.query ?? "",
    sortBy: overrides.sortBy ?? "relevance",
    priceRange: overrides.priceRange ?? {},
  })
}

describe("filterAndSortProducts", () => {
  it("returns every product when no query, sort, or price range is set", () => {
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

  it("composes price range, sort, and text search together", () => {
    // "board" only matches the keyboard by title, and only within range
    expect(
      filterAndSortProducts(products, {
        query: "board",
        sortBy: "price-asc",
        priceRange: { max: 100 },
      }).map((p) => p.id),
    ).toEqual(["2"])
    expect(
      filterAndSortProducts(products, {
        query: "board",
        sortBy: "price-asc",
        priceRange: { max: 50 },
      }),
    ).toEqual([])
  })

  it("returns an empty list when the price range excludes every product", () => {
    expect(filter({ priceRange: { min: 1000 } })).toEqual([])
  })
})

describe("filterAndSortProducts accent-insensitive search", () => {
  const accented = [
    { id: "a", title: "Blusa para bebé", price: 10, stock: 1 },
    { id: "b", title: "Tina", description: "Bañera grande", price: 40, stock: 1 },
    { id: "c", title: "Crème brûlée candle", price: 12, stock: 1 },
    { id: "d", title: "Yoga Mat", price: 5, stock: 1 },
  ]

  function search(query: string) {
    return filterAndSortProducts(accented, { query, sortBy: "relevance", priceRange: {} }).map(
      (p) => p.id,
    )
  }

  it("finds bebé through bebe, bebé, and BEBÉ", () => {
    expect(search("bebe")).toEqual(["a"])
    expect(search("bebé")).toEqual(["a"])
    expect(search("BEBÉ")).toEqual(["a"])
  })

  it("finds bañera through banera in the description", () => {
    expect(search("banera")).toEqual(["b"])
    expect(search("bañera")).toEqual(["b"])
  })

  it("folds other Latin diacritics the same way", () => {
    expect(search("creme brulee")).toEqual(["c"])
    expect(search("CRÈME")).toEqual(["c"])
  })

  it("still matches plain queries and non-matches as before", () => {
    expect(search("yoga")).toEqual(["d"])
    expect(search("nonexistent")).toEqual([])
    expect(search("")).toEqual(["a", "b", "c", "d"])
  })
})
