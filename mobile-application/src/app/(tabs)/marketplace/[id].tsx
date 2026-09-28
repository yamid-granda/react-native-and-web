import { router, useLocalSearchParams } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import { ProductDetailScreen } from "@rnw/components-library"
import { fetchProduct } from "../../../api/client"

export default function ProductDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isLoading, error } = useQuery({
    queryKey: ["product", id],
    queryFn: () => fetchProduct(id),
  })

  return (
    <ProductDetailScreen
      product={data}
      isLoading={isLoading}
      error={error}
      onGoToCart={() => router.push("/cart")}
    />
  )
}
