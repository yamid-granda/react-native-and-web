import { useSessionStore } from "../AuthScreen/useSessionStore"
import type { StoreScreenProps } from "./StoreScreen"
import { useMyStoreProducts, type MyStoreApi } from "./useMyStoreProducts"

/**
 * Everything between `My Store` the route and `StoreScreen` the screen.
 *
 * `api` is injected rather than imported, for the same reason `useMyStoreProducts`
 * takes it: components-library has no api layer, and each app's transport names
 * its own functions. What is left here — the signed-in seller, the cache key, the
 * catalogue query and the delete mutation — is identical on both platforms, so it
 * belongs here rather than in two route files. `onCreate` and `onEdit` are the
 * two callbacks that are genuinely per-platform and stay with the caller.
 *
 * Returns exactly `StoreScreenProps`, so the route spreads them and stops.
 */
export function useMyStoreRoute(
  api: MyStoreApi,
  onCreate: () => void,
  onEdit: (id: string) => void,
): StoreScreenProps {
  const user = useSessionStore((state) => state.user)
  // Keyed on the id rather than the object: a re-render that produces a new but
  // equal user must not re-key the query cache.
  const storeId = user?.id ?? ""
  const store = useMyStoreProducts(storeId, api)

  return {
    storeName: user?.storeName ?? "My Store",
    products: store.products,
    isLoading: store.isLoading,
    error: store.error,
    isMutating: store.isMutating,
    onCreate,
    onEdit,
    onDelete: (id) => store.remove.mutate(id),
  }
}
