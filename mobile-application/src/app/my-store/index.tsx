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
 * The list is read in a child component because of the rule of hooks: the guard
 * can resolve to "anonymous", and the query must not run in that case. The guard
 * is UX only — the API's 401 is the boundary.
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
    (id) => router.push({ pathname: "/my-store/[id]/edit", params: { id } }),
  )

  return <StoreScreen {...store} />
}