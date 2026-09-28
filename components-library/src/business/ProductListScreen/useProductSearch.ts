import { useDeferredValue, useMemo, useState } from "react"
import type { ProductData } from "../../types/Product"

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

// useDeferredValue + memoized filtering: typing doesn't force an immediate
// re-filter of the whole (unbounded, infinite-scroll-accumulated) products
// list on every keystroke.
export function useProductSearch(products: ProductData[]) {
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)

  const results = useMemo(
    () => products.filter((product) => matchesQuery(deferredQuery, product)),
    [products, deferredQuery],
  )

  return { query, setQuery, results }
}
