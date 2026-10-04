import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ProductData, ProductsPage } from "../../types/Product"
import type { ProductFormValues } from "../ProductFormScreen/ProductFormScreen"

/**
 * The api surface this hook needs, injected by the app that owns the transport.
 *
 * components-library deliberately has no api layer: each app has its own `fetch`
 * wrapper (different base-URL resolution, different navigation) and a shared one
 * would have to grow a platform switch. Passing the three functions in is what
 * keeps the *state* pattern shared without sharing the *transport*.
 */
export type MyStoreApi = {
  list: () => Promise<ProductsPage>
  create: (values: ProductFormValues) => Promise<ProductData>
  update: (id: string, values: Partial<ProductFormValues>) => Promise<ProductData>
  remove: (id: string) => Promise<void>
}

/**
 * The cache key for one seller's catalogue.
 *
 * Scoped by the store id, not just "my store", so two sellers signed in on the
 * same device (or a storybook with two sessions) cannot see each other's lists,
 * and so signing out and back in as someone else invalidates rather than reuses.
 */
export function myStoreKey(storeId: string) {
  return ["my-store", storeId] as const
}

/**
 * The cache key for one product.
 *
 * Shared by the public detail screen and the seller's edit screen: they read the
 * same row through the same endpoint, so one helper for the key is what stops a
 * change to either one from quietly becoming a second, separately-cached copy of
 * the same product.
 */
export function productQueryKey(id: string) {
  return ["product", id] as const
}

/**
 * The repo's first mutation, and therefore the pattern the rest will follow:
 * `useMutation` for the write, then invalidate the query that read it. Nothing
 * optimistic — the lists are small and the server is the source of truth, so an
 * optimistic row would only ever be a thing to roll back.
 *
 * Every write invalidates the same key, including a delete: after a delete the
 * cached page is wrong in two ways at once (the row is still there, and `total`
 * is off by one).
 */
export function useMyStoreProducts(storeId: string, api: MyStoreApi) {
  const queryClient = useQueryClient()
  const key = myStoreKey(storeId)

  const products = useQuery({
    queryKey: key,
    queryFn: api.list,
    // Per-user data: never shared, never worth a staleTime longer than the
    // session, and it must not be served from a browser bfcache on the way back
    // from an edit.
    staleTime: 0,
    retry: false,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: key })

  // Each `mutationFn` is wrapped rather than passed straight through: react-query
  // calls it as `(variables, context)`, so an api function handed the reference
  // directly would be handed a QueryClient as a second argument it never asked
  // for.
  const create = useMutation({
    mutationFn: (values: ProductFormValues) => api.create(values),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Partial<ProductFormValues> }) =>
      api.update(id, values),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: refresh,
  })

  return {
    products: products.data?.items ?? [],
    isLoading: products.isPending,
    error: products.error,
    refresh,
    create,
    update,
    remove,
    /** True while any write is in flight, for disabling the whole screen's buttons. */
    isMutating: create.isPending || update.isPending || remove.isPending,
  }
}