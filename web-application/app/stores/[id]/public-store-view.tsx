"use client"

import { useRouter } from "solito/navigation"
import { PublicStoreScreen } from "@rnw/components-library"
import type { ProductData } from "@rnw/components-library"

/**
 * The public storefront's client half.
 *
 * `storeName` and `products` are fetched by the server component, so the
 * storefront is in the initial HTML for crawlers. Only the product-selection
 * callback has to cross the client boundary.
 */
export function PublicStoreView({
  storeName,
  products,
}: {
  storeName: string
  products: ProductData[]
}) {
  const router = useRouter()

  return (
    <PublicStoreScreen
      storeName={storeName}
      products={products}
      onSelectProduct={(id) => router.push(`/marketplace/${id}`)}
    />
  )
}
