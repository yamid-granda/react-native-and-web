import { router } from "expo-router"
import { CheckoutScreen } from "@rnw/components-library"

export default function CheckoutRoute() {
  return (
    <CheckoutScreen
      onGoToCart={() => router.back()}
      onContinueShopping={() => router.push("/marketplace")}
    />
  )
}
