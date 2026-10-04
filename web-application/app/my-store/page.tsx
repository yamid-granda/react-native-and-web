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
 * The list is read in a child component because of the rule of hooks: the guard
 * can resolve to "anonymous", and the query must not run in that case. The guard
 * is UX only — the API's 401 is the boundary.
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
  // The api adapter stays here rather than in `useMyStoreRoute` because it names
  // this app's own transport functions.
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

  const store = useMyStoreRoute(
    api,
    () => router.push("/my-store/new"),
    (id) => router.push(`/my-store/${id}/edit`),
  )

  return <StoreScreen {...store} />
}