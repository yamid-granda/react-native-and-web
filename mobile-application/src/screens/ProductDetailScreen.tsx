import { useQuery } from "@tanstack/react-query"
import type { NativeStackScreenProps } from "@react-navigation/native-stack"
import { ProductDetailScreen as ProductDetailView } from "@rnw/components-library"
import type { RootStackParamList } from "../navigation/RootNavigator"
import { fetchProduct } from "../api/client"

type Props = NativeStackScreenProps<RootStackParamList, "ProductDetail">

export function ProductDetailScreen({ route }: Props) {
  const { productId } = route.params
  const { data, isLoading, error } = useQuery({
    queryKey: ["product", productId],
    queryFn: () => fetchProduct(productId),
  })

  return <ProductDetailView product={data} isLoading={isLoading} error={error} />
}
