import { useQuery } from "@tanstack/react-query"
import type { ProductData, ProductsPage } from "../../types/Product"
import type { ProductFormValues } from "../ProductFormScreen/ProductFormScreen"

/**
 * The api surface a My Store screen needs, injected by the app that owns the
 * transport.
 *
 * components-library deliberately has no api layer: each app has its own `fetch`
 * wrapper (different base-URL resolution, different navigation) and a shared one
 * would have to grow a platform switch. Passing the functions in is what keeps
 * the *state* pattern shared without sharing the *transport*.
 *
 * The hooks below each take only the members they use — `Pick` rather than this
 * whole type — so a caller cannot hand over a write function to a read hook and
 * have it look wired up.
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
 * Written out in four route files before this existed, in two apps. It has to be
 * one function because the marketplace detail screen and the seller edit screen
 * are the *same* read — a seller who saves an edit and goes back to the detail
 * screen must see it — and a key spelled two ways is two cache entries for one
 * product.
 */
export function productQueryKey(id: string) {
  return ["product", id] as const
}

/**
 * The cache key for the whole catalogue, across every seller.
 *
 * The one key with no id in it: `/products` is the marketplace's paginated view
 * of all products, which is exactly why a seller write has to retire it.
 */
export const PRODUCTS_KEY = ["products"] as const

/** The cache key for one store's public profile. */
export function storeKey(id: string) {
  return ["store", id] as const
}

/** The cache key for one store's public product list. */
export function storeProductsKey(id: string) {
  return ["store-products", id] as const
}

/**
 * Every cache entry a seller write to `productId` can make wrong.
 *
 * `["my-store", storeId]` is the seller's own list. `["products"]` and
 * `["product", id]` are the catalogue the edit screen itself read, and the two
 * store keys are the public storefront, which shows the same rows. All of them
 * sit under the app's five-minute `staleTime`, so a write that retires only the
 * first key leaves a buyer looking at a price the seller has already changed.
 *
 * `invalidateQueries` prefix-matches, so one entry per family is enough.
 */
export function productWriteKeys(storeId: string, productId: string) {
  return [
    myStoreKey(storeId),
    PRODUCTS_KEY,
    productQueryKey(productId),
    storeKey(storeId),
    storeProductsKey(storeId),
  ] as const
}

/**
 * The read half of "my store": one seller's product list.
 *
 * The write half is `useMyStoreMutations`, split out because the *forms* live in
 * routes this hook is not mounted by, and a write that skips the seam is a write
 * that invalidates nothing. Nothing optimistic: the lists are small and the server
 * is the source of truth, so an optimistic row would only ever be a thing to roll
 * back.
 */
export function useMyStoreProducts(storeId: string, api: Pick<MyStoreApi, "list">) {
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

  return {
    products: products.data?.items ?? [],
    isLoading: products.isPending,
    error: products.error,
  }
}