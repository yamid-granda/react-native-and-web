import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { connection } from "next/server"
import type { ProductsPage, StoreProfile } from "@rnw/components-library"
import { getStore, getStoreProducts } from "../../../lib/api-server"
import { CatalogueUnavailable } from "../../catalogue-unavailable"
import { PublicStoreView } from "./public-store-view"

/**
 * No build-time catalogue read: storefronts are generated on first visit and
 * cached by ISR, so `next build` never needs the API. See README "Per-route mapping".
 */
export function generateStaticParams() {
  return []
}

export async function generateMetadata({ params }: PageProps<"/stores/[id]">): Promise<Metadata> {
  const { id } = await params
  let store: StoreProfile | null
  try {
    store = await getStore(id)
  } catch {
    return {}
  }

  if (!store) return { title: "Store not found" }

  return {
    title: store.storeName,
    description: `Browse everything ${store.storeName} sells on the marketplace.`,
    openGraph: { title: store.storeName, type: "website" },
  }
}

/**
 * The public storefront, server-rendered for SEO.
 *
 * Unauthenticated on purpose, like the marketplace it sits in: a storefront is a
 * catalogue page, and the API is the boundary that never asked for a token here.
 */
export default async function StorePage({ params }: PageProps<"/stores/[id]">) {
  const { id } = await params

  let store: StoreProfile | null
  let products: ProductsPage | null
  try {
    ;[store, products] = await Promise.all([getStore(id), getStoreProducts(id)])
  } catch {
    await connection()
    return <CatalogueUnavailable />
  }

  if (!store) notFound()

  return <PublicStoreView storeName={store.storeName} products={products?.items ?? []} />
}
