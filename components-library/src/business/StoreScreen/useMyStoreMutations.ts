import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ProductFormValues } from "../ProductFormScreen/ProductFormScreen"
import { productWriteKeys, type MyStoreApi } from "./useMyStoreProducts"

/**
 * The repo's mutation pattern, and therefore the pattern the rest will follow:
 * `useMutation` for the write, then invalidate the queries that read it. Nothing
 * optimistic — the lists are small and the server is the source of truth, so an
 * optimistic row would only ever be a thing to roll back.
 *
 * Its own hook rather than a third of `useMyStoreProducts`, because the two form
 * routes that create and edit are not the list route: a seller id is available
 * app-wide through `useSessionStore`, so a write needs the store id and the api,
 * not the list query.
 */
export function useMyStoreMutations(
  storeId: string,
  api: Pick<MyStoreApi, "create" | "update" | "remove">,
) {
  const queryClient = useQueryClient()

  /**
   * Retires everything a write to `productId` can make wrong.
   *
   * One place, so "which keys does a seller write invalidate" has a single
   * answer. After a delete the seller's page is wrong in two ways at once — the
   * row is still there, and `total` is off by one — and the same is true of the
   * catalogue and the storefront.
   *
   * `refetchType` is left at its default, `"active"`: an active query refetches
   * now, an inactive one is marked stale and refetches when it next mounts,
   * which is what a buyer opening the marketplace straight after a seller saved
   * needs. The marketplace list is not mounted while the seller is on
   * `/my-store/new`, so it is the second case, not a missed refetch.
   */
  const retire = (productId: string) =>
    Promise.all(
      productWriteKeys(storeId, productId).map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    )

  // Each `mutationFn` is wrapped rather than passed straight through: react-query
  // calls it as `(variables, context)`, so an api function handed the reference
  // directly would be handed a QueryClient as a second argument it never asked
  // for.
  const create = useMutation({
    mutationFn: (values: ProductFormValues) => api.create(values),
    onSuccess: (created) => retire(created.id),
  })
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ProductFormValues> }) =>
      api.update(id, values),
    onSuccess: (_, { id }) => retire(id),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: (_, id) => retire(id),
  })

  return {
    create,
    update,
    remove,
    /** True while any write is in flight, for disabling the whole screen's buttons. */
    isMutating: create.isPending || update.isPending || remove.isPending,
  }
}