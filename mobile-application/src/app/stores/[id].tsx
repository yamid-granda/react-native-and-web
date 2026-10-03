import { router, useLocalSearchParams } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import { PublicStoreScreen } from "@rnw/components-library"
import { fetchStore, fetchStoreProducts } from "../../api/client"

/**
 * The public storefront.
 *
 * Unauthenticated on purpose: a storefront is a catalogue page, and the
 * marketplace it sits in never asked for a token.
 */
export default function StoreRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()

  const store = useQuery({ queryKey: ["store", id], queryFn: () => fetchStore(id) })
  const products = useQuery({
    queryKey: ["store-products", id],
    queryFn: () => fetchStoreProducts(id),
  })

  return (
    <PublicStoreScreen
      storeName={store.data?.storeName ?? "Store"}
      products={products.data?.items ?? []}
      isLoading={store.isPending || products.isPending}
      error={store.error ?? products.error}
      onSelectProduct={(productId) =>
        router.push({ pathname: "/marketplace/[id]", params: { id: productId } })
      }
    />
  )
}