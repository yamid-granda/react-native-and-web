"use client"

import { use } from "react"
import { useRouter } from "solito/navigation"
import { useQuery } from "@tanstack/react-query"
import { PublicStoreScreen, storeKey, storeProductsKey } from "@rnw/components-library"
import { fetchStore, fetchStoreProducts } from "../../../lib/api"

/**
 * The public storefront.
 *
 * Unauthenticated on purpose: a storefront is a catalogue page, and the
 * marketplace it sits in never asked for a token.
 *
 * Shape follows `app/marketplace/[id]/page.tsx` — `params` is a promise, so
 * `use(params)` suspends on the first render.
 */
export default function StorePage({ params }: PageProps<"/stores/[id]">) {
  const { id } = use(params)
  const router = useRouter()

  const store = useQuery({ queryKey: storeKey(id), queryFn: () => fetchStore(id) })
  const products = useQuery({
    queryKey: storeProductsKey(id),
    queryFn: () => fetchStoreProducts(id),
  })

  return (
    <PublicStoreScreen
      storeName={store.data?.storeName ?? "Store"}
      products={products.data?.items ?? []}
      isLoading={store.isPending || products.isPending}
      error={store.error ?? products.error}
      onSelectProduct={(productId) => router.push(`/marketplace/${productId}`)}
    />
  )
}