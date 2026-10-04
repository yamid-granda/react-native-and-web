import { useSessionStore } from "../AuthScreen/useSessionStore"
import { useMyStoreProducts, type MyStoreApi } from "./useMyStoreProducts"

/**
 * The data half of the "my store" route, as `StoreScreen` props.
 *
 * The composition between the session store and `useMyStoreProducts` — read the
 * user, key the list on the store id, hand the screen its rows and its flags — is
 * identical on both platforms; only the `onCreate`/`onEdit` callbacks differ, so
 * those are the two things a caller has to supply. The api adapter stays with the
 * caller because it names that app's own transport functions.
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

  return {
    storeName: user?.storeName ?? "My Store",
    products: store.products,
    isLoading: store.isLoading,
    error: store.error,
    isMutating: store.isMutating,
    onCreate,
    onEdit,
    onDelete: (id: string) => store.remove.mutate(id),
  }
}