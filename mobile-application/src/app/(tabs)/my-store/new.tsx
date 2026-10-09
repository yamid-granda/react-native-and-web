import { useCallback } from "react"
import { router } from "expo-router"
import {
  ProductFormScreen,
  SessionGate,
  useMyStoreMutations,
  useSessionStore,
} from "@rnw/components-library"
import { myStoreApi } from "../../../api/client"

export default function NewProductRoute() {
  const signIn = useCallback(() => router.replace("/my-store/login"), [])
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
            // Back to the list rather than the new product's own screen: the list is
            // what a seller came here to see, and the mutation already invalidated
            // it.
            router.replace("/my-store")
          } catch {
            // `create.error` is what ProductFormScreen renders; no local error state,
            // and no `cause instanceof Error` normalisation.
          }
        }}
      />
    </SessionGate>
  )
}