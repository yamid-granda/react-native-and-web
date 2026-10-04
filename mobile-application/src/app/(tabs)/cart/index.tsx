import { router } from "expo-router"
import { CartScreen } from "@rnw/components-library"
import { fetchProductsByIds } from "../../../api/client"

export default function CartRoute() {
  return (
    <CartScreen
      onCheckout={() => router.push("/cart/checkout")}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
