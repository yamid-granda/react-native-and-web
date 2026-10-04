import { router, useLocalSearchParams } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import { ProductDetailScreen, productQueryKey } from "@rnw/components-library"
import { fetchProduct } from "../../../api/client"

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
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
      onOpenStore={(storeId) => router.push({ pathname: "/stores/[id]", params: { id: storeId } })}
    />
  )
}