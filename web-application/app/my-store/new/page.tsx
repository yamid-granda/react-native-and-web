"use client"

import { useCallback } from "react"
import { useRouter } from "solito/navigation"
import {
  ProductFormScreen,
  SessionGate,
  useMyStoreMutations,
  useSessionStore,
} from "@rnw/components-library"
import { myStoreApi } from "../../../lib/api"

export default function NewProductPage() {
  const router = useRouter()
  const signIn = useCallback(() => router.replace("/login"), [router])
  // The write seam, keyed on the signed-in seller. Read from the session store
  // rather than from the list route's props, so this route needs nothing but the
  // store id to reach it.
  const storeId = useSessionStore((state) => state.user?.id ?? "")
  const store = useMyStoreMutations(storeId, myStoreApi)

  return (
    <SessionGate onSignIn={signIn}>
      <ProductFormScreen
        isSubmitting={store.create.isPending}
        error={store.create.error}
        onCancel={() => router.back()}
        onSubmit={async (values) => {
          try {
            await store.create.mutateAsync(values)
            // Back to the list rather than the new product's page: the list is what
            // a seller came here to see, and it is already invalidated by the
            // mutation.
            router.replace("/my-store")
          } catch {
            // `create.error` is what ProductFormScreen renders; no local error
            // state, and no `cause instanceof Error` normalisation.
          }
        }}
      />
    </SessionGate>
  )
}