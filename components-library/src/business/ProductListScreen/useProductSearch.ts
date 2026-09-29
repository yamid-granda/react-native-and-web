import { useDeferredValue, useMemo, useState } from "react"
import type { ProductData } from "../../types/Product"

export type SortOption = "relevance" | "price-asc" | "price-desc"
export type PriceRange = { min?: number; max?: number }

function matchesPriceRange(price: number, { min, max }: PriceRange) {
  if (min !== undefined && price < min) return false
  if (max !== undefined && price > max) return false
  return true
}

// Query matching happens server-side (see useInfiniteProducts) so that
// search reflects the whole catalog, not just already-fetched pages —
// `products` here is assumed to already reflect the active query.
export function filterAndSortProducts(
  products: ProductData[],
  { sortBy, priceRange }: { sortBy: SortOption; priceRange: PriceRange },
) {
  const filtered = products.filter((product) => matchesPriceRange(product.price, priceRange))
  if (sortBy === "price-asc") return filtered.sort((a, b) => a.price - b.price)
  if (sortBy === "price-desc") return filtered.sort((a, b) => b.price - a.price)
  return filtered
}

// useDeferredValue + memoized filtering: typing/dragging a price bound
// doesn't force an immediate re-filter of the whole (unbounded,
// infinite-scroll-accumulated) products list on every keystroke.
export function useProductSearch(products: ProductData[]) {
  const [query, setQuery] = useState("")
  const [sortBy, setSortBy] = useState<SortOption>("relevance")
  const [priceRange, setPriceRange] = useState<PriceRange>({})
  const deferredQuery = useDeferredValue(query)
  const deferredPriceRange = useDeferredValue(priceRange)

  const results = useMemo(
    () => filterAndSortProducts(products, { sortBy, priceRange: deferredPriceRange }),
    [products, sortBy, deferredPriceRange],
  )

  return { query, setQuery, deferredQuery, sortBy, setSortBy, priceRange, setPriceRange, results }
}
