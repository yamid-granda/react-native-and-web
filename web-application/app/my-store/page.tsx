"use client"

import { useCallback, useMemo } from "react"
import { useRouter } from "solito/navigation"
import { SessionGate, StoreScreen, useMyStoreRoute } from "@rnw/components-library"
import {
  createMyProduct,
  deleteMyProduct,
  fetchMyProducts,
  updateMyProduct,
} from "../../lib/api"

/**
 * My Store: the seller's own product list.
 *
 * Routing and this app's api adapter, and nothing else. `SessionGate` owns the
 * session guard and `useMyStoreRoute` the query wiring, so the parts that were
 * copy-pasted into the mobile twin live in components-library instead.
 */
export default function MyStorePage() {
  const router = useRouter()
  const signIn = useCallback(() => router.replace("/login"), [router])

  return (
    <SessionGate onSignIn={signIn}>
      <SignedInStore />
    </SessionGate>
  )
}

function SignedInStore() {
  const router = useRouter()
  const api = useMemo(
    () => ({
      list: fetchMyProducts,
      create: createMyProduct,
      update: (id: string, values: Parameters<typeof updateMyProduct>[1]) =>
        updateMyProduct(id, values),
      remove: deleteMyProduct,
    }),
    [],
  )

  const props = useMyStoreRoute(
    api,
    () => router.push("/my-store/new"),
    (id) => router.push(`/my-store/${id}/edit`),
  )

  return <StoreScreen {...props} />
}
