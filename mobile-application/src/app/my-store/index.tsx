import { useCallback, useMemo } from "react"
import { router } from "expo-router"
import { Text } from "react-native"
import {
  StoreScreen,
  useMyStoreProducts,
  useRequireSession,
  useSessionStore,
} from "@rnw/components-library"
import {
  createMyProduct,
  deleteMyProduct,
  fetchMyProducts,
  updateMyProduct,
} from "../../api/client"

/**
 * My Store: the seller's own product list.
 *
 * Split in two because of the rule of hooks: the session guard can resolve to
 * "anonymous", and `useMyStoreProducts` must not run in that case. The guard is
 * UX only — the API's 401 is the boundary.
 */
export default function MyStoreRoute() {
  const session = useRequireSession({
    onSignIn: useCallback(() => router.replace("/login"), []),
  })

  if (session.status === "loading") {
    return <Text className="p-6 text-muted">Checking your session…</Text>
  }
  if (session.status === "anonymous") return null

  return <SignedInStore />
}

function SignedInStore() {
  const user = useSessionStore((state) => state.user)
  // Keyed on the id rather than the object: a re-render that produces a new but
  // equal user must not re-key the query cache.
  const storeId = user?.id ?? ""

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
  const store = useMyStoreProducts(storeId, api)

  return (
    <StoreScreen
      storeName={user?.storeName ?? "My Store"}
      products={store.products}
      isLoading={store.isLoading}
      error={store.error}
      isMutating={store.isMutating}
      onCreate={() => router.push("/my-store/new")}
      onEdit={(id) => router.push({ pathname: "/my-store/[id]/edit", params: { id } })}
      onDelete={(id) => store.remove.mutate(id)}
    />
  )
}