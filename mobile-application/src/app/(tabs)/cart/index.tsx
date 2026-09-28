import { router } from "expo-router"
import { CartScreen } from "@rnw/components-library"

export default function CartRoute() {
  return <CartScreen onCheckout={() => router.push("/cart/checkout")} />
}
