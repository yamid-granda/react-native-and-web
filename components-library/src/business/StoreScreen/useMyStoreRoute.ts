import { useEffect } from "react"
import { ApiError } from "../../api/transport"
import { useSessionStore } from "../AuthScreen/useSessionStore"
import { useMyStoreMutations } from "./useMyStoreMutations"
import { useMyStoreProducts, type MyStoreApi } from "./useMyStoreProducts"

/** An expired session, as the transport reports it. */
function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401
}

/**
 * Sign the seller out when the API says the session is no longer valid.
 *
 * `ApiError.status` is the field `ApiError` was built for, and this is its reader:
 * clearing the session flips `useRequireSession` to "anonymous", and the
 * `SessionGate` every My Store route is already wrapped in sends the seller to the
 * login screen. One place, both platforms, and no per-app wiring — which is only
 * possible because the transport is shared and there is a single `ApiError`.
 */
function useSignOutOnUnauthorized(...errors: Array<unknown>) {
  const clear = useSessionStore((state) => state.clear)
  const unauthorized = errors.some(isUnauthorized)

  useEffect(() => {
    if (unauthorized) clear()
  }, [unauthorized, clear])
}

/**
 * The data half of the "my store" route, as `StoreScreen` props.
 *
 * The composition between the session store and the My Store hooks — read the
 * user, key the list on the store id, hand the screen its rows and its flags — is
 * identical on both platforms; only the `onCreate`/`onEdit` callbacks differ, so
 * those are the two things a caller has to supply. The api adapter stays with the
 * caller because `baseUrl` and the session token are that app's.
 */
export function useMyStoreRoute(
  api: MyStoreApi,
  onCreate: () => void,
  onEdit: (id: string) => void,
) {
  const user = useSessionStore((state) => state.user)
  // Keyed on the id rather than the object: a re-render that produces a new but
  // equal user must not re-key the query cache.
  const storeId = user?.id ?? ""

  const store = useMyStoreProducts(storeId, api)
  const writes = useMyStoreMutations(storeId, api)

  useSignOutOnUnauthorized(
    store.error,
    writes.create.error,
    writes.update.error,
    writes.remove.error,
  )

  return {
    storeName: user?.storeName ?? "My Store",
    products: store.products,
    isLoading: store.isLoading,
    error: store.error,
    isMutating: writes.isMutating,
    onCreate,
    onEdit,
    onDelete: (id: string) => writes.remove.mutate(id),
  }
}
