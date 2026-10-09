"use client"

import { useRouter } from "solito/navigation"
import { CheckoutScreen } from "@rnw/components-library"
import { fetchProductsByIds } from "../../lib/api"

export default function CheckoutPage() {
  const router = useRouter()

  return (
    <CheckoutScreen
      onGoToCart={() => router.push("/cart")}
      onContinueShopping={() => router.push("/")}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
