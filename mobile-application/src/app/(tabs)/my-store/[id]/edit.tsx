import { useCallback, useState } from "react"
import { router, useLocalSearchParams } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import {
  ProductEditorScreen,
  SessionGate,
  productQueryKey,
  useMyStoreMutations,
  useSessionStore,
} from "@rnw/components-library"
import { fetchProduct, myStoreApi } from "../../../../api/client"

/**
 * Edit one of the caller's products.
 *
 * The product is read through the *public* `GET /products/{id}`: there is no
 * `GET /my-store/products/{id}` route, because a seller editing their own product
 * can already read it publicly, and a second route would only exist to hide a row
 * the marketplace shows anyway.
 *
 * The read sits in a child component because of the rule of hooks: it only runs
 * once `SessionGate` has let a signed-in seller past, which is also why it needs
 * no `enabled` gate of its own.
 */
export default function EditProductRoute() {
  const signIn = useCallback(() => router.replace("/my-store/login"), [])

  return (
    <SessionGate onSignIn={signIn}>
      <EditProductForm />
    </SessionGate>
  )
}

function EditProductForm() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const storeId = useSessionStore((state) => state.user?.id ?? "")
  // The write seam, so saving retires the `["product", id]` this screen read as
  // well as the seller's own list.
  const store = useMyStoreMutations(storeId, myStoreApi)

  const { data: product, isLoading, error: loadError } = useQuery({
    queryKey: productQueryKey(id),
    queryFn: () => fetchProduct(id),
  })

  return (
    <ProductEditorScreen
      product={product}
      isLoading={isLoading}
      // A product that is not the caller's comes back as a 404, not a 403 — so
      // "not found" and "not yours" render the same screen, which is deliberate.
      error={loadError ?? error}
      isSubmitting={isSubmitting}
      setSubmitting={setIsSubmitting}
      setError={setError}
      update={(productId, values) => store.update.mutateAsync({ id: productId, values })}
      onDone={() => router.replace("/my-store")}
      onCancel={() => router.back()}
    />
  )
}