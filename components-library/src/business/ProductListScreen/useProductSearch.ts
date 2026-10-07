import { useDeferredValue, useMemo, useState } from "react"
import type { ProductData } from "../../types/Product"

export type SortOption = "relevance" | "price-asc" | "price-desc"
export type PriceRange = { min?: number; max?: number }

// same substring-match approach as IconsGallery's search. Only matches
// against products already fetched — search doesn't query further pages.
function matchesQuery(query: string, product: ProductData) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    product.title.toLowerCase().includes(normalized) ||
    (product.description?.toLowerCase().includes(normalized) ?? false)
  )
}

function matchesPriceRange(price: number, { min, max }: PriceRange) {
  if (min !== undefined && price < min) return false
  if (max !== undefined && price > max) return false
  return true
}

export function filterAndSortProducts(
  products: ProductData[],
  { query, sortBy, priceRange }: { query: string; sortBy: SortOption; priceRange: PriceRange },
) {
  const filtered = products.filter(
    (product) => matchesQuery(query, product) && matchesPriceRange(product.price, priceRange),
  )
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
    () =>
      filterAndSortProducts(products, {
        query: deferredQuery,
        sortBy,
        priceRange: deferredPriceRange,
      }),
    [products, deferredQuery, sortBy, deferredPriceRange],
  )

  return {
    query,
    setQuery,
    sortBy,
    setSortBy,
    priceRange,
    setPriceRange,
    results,
    // The deferred query is what the search bar emits upward to drive
    // `useInfiniteProducts`; exposing it from the hook keeps the debounce
    // (and the same React-internal id) in one place.
    deferredQuery,
  }
}
