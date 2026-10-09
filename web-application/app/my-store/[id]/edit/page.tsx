"use client"

import { use, useCallback, useState } from "react"
import { useRouter } from "solito/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  ProductEditorScreen,
  SessionGate,
  productQueryKey,
  useMyStoreMutations,
  useSessionStore,
} from "@rnw/components-library"
import { fetchProduct, myStoreApi } from "../../../../lib/api"
import { revalidateCatalogue } from "../../../actions"

/**
 * Edit one of the caller's products.
 *
 * The product is read through the *public* `GET /products/{id}`: there is no
 * `GET /my-store/products/{id}` route, because a seller editing their own product
 * can already read it publicly, and a second route would only exist to hide a row
 * the marketplace shows anyway.
 *
 * Shape follows `app/product/[id]/page.tsx` exactly — `params` is a promise,
 * so `use(params)` suspends on the first render.
 *
 * The read sits in a child component because of the rule of hooks: it only runs
 * once `SessionGate` has let a signed-in seller past, which is also why it needs
 * no `enabled` gate of its own.
 */
export default function EditProductPage({ params }: PageProps<"/my-store/[id]/edit">) {
  const { id } = use(params)
  const router = useRouter()
  const signIn = useCallback(() => router.replace("/login"), [router])

  return (
    <SessionGate onSignIn={signIn}>
      <EditProductForm id={id} />
    </SessionGate>
  )
}

function EditProductForm({ id }: { id: string }) {
  const router = useRouter()
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
      update={async (productId, values) => {
        const updated = await store.update.mutateAsync({ id: productId, values })
        // Best-effort: the save already succeeded, so a failed revalidation must
        // not read as a failed edit. The public cache falls back to its
        // revalidate window.
        await revalidateCatalogue(productId, storeId).catch(() => {})
        return updated
      }}
      onDone={() => router.replace("/my-store")}
      onCancel={() => router.back()}
    />
  )
}