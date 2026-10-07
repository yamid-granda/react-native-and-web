"use client"

import { useCallback } from "react"
import { useRouter } from "solito/navigation"
import { SessionGate, StoreScreen, useMyStoreRoute, useSessionStore } from "@rnw/components-library"
import { myStoreApi } from "../../lib/api"
import { revalidateCatalogue } from "../actions"

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
  const storeId = useSessionStore((state) => state.user?.id ?? "")
  // The api adapter is `lib/api`'s `myStoreApi`: it names this app's own transport
  // functions, and every My Store route needs it.
  const store = useMyStoreRoute(
    myStoreApi,
    () => router.push("/my-store/new"),
    (id) => router.push(`/my-store/${id}/edit`),
  )

  return (
    <StoreScreen
      {...store}
      onDelete={(id) => {
        store.onDelete(id)
        // The mutation retires React Query; this retires the ISR pages a delete
        // removes the product from. Fire-and-forget: revalidation happens on the
        // next visit, after the delete has committed.
        void revalidateCatalogue(id, storeId).catch(() => {})
      }}
    />
  )
}