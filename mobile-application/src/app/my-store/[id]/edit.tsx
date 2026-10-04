import { useCallback } from "react"
import { router, useLocalSearchParams } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import {
  ProductEditorScreen,
  SessionGate,
  productQueryKey,
} from "@rnw/components-library"
import { fetchProduct, updateMyProduct } from "../../../api/client"

/**
 * Edit one of the caller's products.
 *
 * The product is read through the *public* `GET /products/{id}`: there is no
 * `GET /my-store/products/{id}` route, because a seller editing their own product
 * can already read it publicly, and a second route would only exist to hide a row
 * the marketplace shows anyway.
 *
 * The read stays here because `fetchProduct` is this app's transport; the save and
 * the session guard do not touch the transport, so they are shared.
 */
export default function EditProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const signIn = useCallback(() => router.replace("/login"), [])

  return (
    <SessionGate onSignIn={signIn}>
      <EditProductForm
        id={id}
        onDone={() => router.replace("/my-store")}
        onCancel={() => router.back()}
      />
    </SessionGate>
  )
}

/**
 * Behind the gate, so the query needs no `enabled` of its own: `SessionGate`
 * renders nothing until there is a session, and by then this is only mounted for
 * a signed-in seller.
 */
function EditProductForm({
  id,
  onDone,
  onCancel,
}: {
  id: string
  onDone: () => void
  onCancel: () => void
}) {
  const { data: product, isLoading, error } = useQuery({
    queryKey: productQueryKey(id),
    queryFn: () => fetchProduct(id),
  })

  return (
    <ProductEditorScreen
      product={product}
      isLoading={isLoading}
      // A product that is not the caller's comes back as a 404, not a 403 — so
      // "not found" and "not yours" render the same screen, which is deliberate.
      error={error}
      update={updateMyProduct}
      onDone={onDone}
      onCancel={onCancel}
    />
  )
}
