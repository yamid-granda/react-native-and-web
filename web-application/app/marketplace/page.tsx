"use client"

import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ProductListScreen } from "@rnw/components-library"
import { fetchProducts } from "../../lib/api"

export default function MarketplacePage() {
  const router = useRouter()
  const { data, isLoading, error } = useQuery({ queryKey: ["products"], queryFn: fetchProducts })

  return (
    <ProductListScreen
      products={data ?? []}
      isLoading={isLoading}
      error={error}
      onSelectProduct={(id) => router.push(`/marketplace/${id}`)}
    />
  )
}
