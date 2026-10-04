"use client"

import { useRouter } from "solito/navigation"
import { CartScreen } from "@rnw/components-library"
import { fetchProductsByIds } from "../../lib/api"

export default function CartPage() {
  const router = useRouter()

  return (
    <CartScreen
      onCheckout={() => router.push("/checkout")}
      fetchProductsByIds={fetchProductsByIds}
    />
  )
}
