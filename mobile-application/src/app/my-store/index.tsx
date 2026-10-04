import { useCallback, useMemo } from "react"
import { router } from "expo-router"
import { SessionGate, StoreScreen, useMyStoreRoute } from "@rnw/components-library"
import {
  createMyProduct,
  deleteMyProduct,
  fetchMyProducts,
  updateMyProduct,
} from "../../api/client"

/**
 * My Store: the seller's own product list.
 *
 * Routing and this app's api adapter, and nothing else. `SessionGate` owns the
 * session guard and `useMyStoreRoute` the query wiring, so the parts that were
 * copy-pasted into the web twin live in components-library instead.
 */
export default function MyStoreRoute() {
  const signIn = useCallback(() => router.replace("/login"), [])

  return (
    <SessionGate onSignIn={signIn}>
      <SignedInStore />
    </SessionGate>
  )
}

function SignedInStore() {
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
    (id) => router.push({ pathname: "/my-store/[id]/edit", params: { id } }),
  )

  return <StoreScreen {...props} />
}
