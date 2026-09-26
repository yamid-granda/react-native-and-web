import { useQuery } from "@tanstack/react-query"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { ProductListScreen } from "@rnw/components-library"
import type { RootStackParamList } from "../navigation/RootNavigator"
import { fetchProducts } from "../api/client"

type Props = NativeStackScreenProps<RootStackParamList, "Marketplace">

export function MarketplaceScreen({ navigation }: Props) {
  const { data, isLoading, error } = useQuery({ queryKey: ["products"], queryFn: fetchProducts })

  return (
    <ProductListScreen
      products={data ?? []}
      isLoading={isLoading}
      error={error}
      onSelectProduct={(productId) => navigation.navigate("ProductDetail", { productId })}
    />
  )
}
