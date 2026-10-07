import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import type { ProductData } from "@rnw/components-library"
import { getProduct } from "../../../lib/api-server"
import { CatalogueUnavailable } from "../../catalogue-unavailable"
import { ProductDetailView } from "./product-detail-view"

/**
 * No build-time catalogue read: product pages are generated on first visit and
 * cached by ISR, so `next build` never needs the API. See README "Per-route mapping".
 */
export function generateStaticParams() {
  return []
}

export async function generateMetadata({
  params,
}: PageProps<"/marketplace/[id]">): Promise<Metadata> {
  const { id } = await params
  let product: ProductData | null
  try {
    product = await getProduct(id)
  } catch {
    // The API is down; render the page without page-specific metadata rather
    // than failing the whole route.
    return {}
  }

  if (!product) return { title: "Product not found" }

  const description = product.description || `Buy ${product.title} on the marketplace.`
  return {
    title: product.title,
    description,
    openGraph: {
      title: product.title,
      description,
      type: "website",
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  }
}

/**
 * The product detail page, server-rendered for SEO.
 *
 * `getProduct` is the same cached, tagged read `generateMetadata` makes (Next
 * memoizes it within the render), so the product's name, price and stock are in
 * the initial HTML and a seller edit retires the page on demand.
 */
export default async function ProductDetailPage({ params }: PageProps<"/marketplace/[id]">) {
  const { id } = await params

  let product: ProductData | null
  try {
    product = await getProduct(id)
  } catch {
    await connection()
    return <CatalogueUnavailable />
  }

  if (!product) notFound()

  return <ProductDetailView product={product} />
}
