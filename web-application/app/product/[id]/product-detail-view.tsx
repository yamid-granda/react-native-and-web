"use client"

import { useRouter } from "solito/navigation"
import { ProductDetailScreenWithSemantics } from "@rnw/components-library"
import type { ProductData } from "@rnw/components-library"

/**
 * The product detail's client half.
 *
 * `product` is fetched by the server component, so the name, price and stock are
 * in the initial HTML. This wrapper only supplies the two callbacks a Server
 * Component cannot pass across the boundary (functions are not serializable).
 *
 * On web, the screen is wrapped in semantic HTML (`<article>` + `<h1>`) for SEO.
 */
export function ProductDetailView({ product }: { product: ProductData }) {
  const router = useRouter()

  return (
    <ProductDetailScreenWithSemantics
      product={product}
      onGoToCart={() => router.push("/cart")}
      onOpenStore={(storeId) => router.push(`/stores/${storeId}`)}
    />
  )
}
