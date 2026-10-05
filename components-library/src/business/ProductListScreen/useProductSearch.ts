import { useDeferredValue, useEffect, useMemo, useState } from "react"
import type { ProductData } from "../../types/Product"

export type SortOption = "relevance" | "price-asc" | "price-desc"
export type PriceRange = { min?: number; max?: number }

/**
 * How long the shopper has to stop typing before the term becomes a request.
 *
 * Not cosmetic: the server answers a search with `ILIKE '%term%'`, which no index
 * can serve, so one keystroke is one sequential scan. `useDeferredValue` below
 * solves the *render* problem and is not a substitute — it coalesces work under
 * load, but every distinct value still reaches the network.
 */
const SEARCH_DEBOUNCE_MS = 250

/**
 * The same substring match the server applies, kept for what it is still good for.
 *
 * The listing itself is filtered by the server now — see `useInfiniteProducts` —
 * so this is not what makes a search find anything. It is what keeps the grid
 * honest for the ~250ms between a keystroke and the response: without it the
 * unfiltered page-1 rows would keep on screen, showing products that do not match
 * what was just typed.
 */
function matchesQuery(query: string, product: ProductData) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    product.title.toLowerCase().includes(normalized) ||
    (product.description?.toLowerCase().includes(normalized) ?? false)
  )
}

/** A value that stops changing once it has been still for `delayMs`. */
function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
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
  const settledQuery = useSettledValue(query, SEARCH_DEBOUNCE_MS)

  const results = useMemo(
    () =>
      filterAndSortProducts(products, {
        query: deferredQuery,
        sortBy,
        priceRange: deferredPriceRange,
      }),
    [products, deferredQuery, sortBy, deferredPriceRange],
  )

  // `settledQuery`, not `query`: this is the term a list screen hands up to be
  // turned into a request, and one request per pause is the whole point.
  return {
    query,
    setQuery,
    settledQuery,
    sortBy,
    setSortBy,
    priceRange,
    setPriceRange,
    results,
  }
}
