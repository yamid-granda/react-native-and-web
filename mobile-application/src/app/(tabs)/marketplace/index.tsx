import { router } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import { ProductListScreen } from "@rnw/components-library"
import { fetchProducts } from "../../../api/client"

export default function MarketplaceScreen() {
  const { data, isLoading, error } = useQuery({ queryKey: ["products"], queryFn: fetchProducts })

  return (
    <ProductListScreen
      products={data ?? []}
      isLoading={isLoading}
      error={error}
      onSelectProduct={(productId) =>
        router.push({ pathname: "/marketplace/[id]", params: { id: productId } })
      }
    />
  )
}
