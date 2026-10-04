"use client"

import { use } from "react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "solito/navigation"
import { ProductDetailScreen, productQueryKey } from "@rnw/components-library"
import { fetchProduct } from "../../../lib/api"

export default function ProductDetailPage({ params }: PageProps<"/marketplace/[id]">) {
  const { id } = use(params)
  const router = useRouter()
  const { data, isLoading, error } = useQuery({
    queryKey: productQueryKey(id),
    queryFn: () => fetchProduct(id),
  })

  return (
    <ProductDetailScreen
      product={data}
      isLoading={isLoading}
      error={error}
      onGoToCart={() => router.push("/cart")}
      // Only rendered when the product actually has a seller, so a seeded product
      // gets no dead affordance.
      onOpenStore={(storeId) => router.push(`/stores/${storeId}`)}
    />
  )
}