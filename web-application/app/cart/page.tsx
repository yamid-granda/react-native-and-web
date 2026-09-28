"use client"

import { useRouter } from "solito/navigation"
import { CartScreen } from "@rnw/components-library"

export default function CartPage() {
  const router = useRouter()

  return <CartScreen onCheckout={() => router.push("/checkout")} />
}
