import { useCallback, useState } from "react"
import { router, useLocalSearchParams } from "expo-router"
import { useQuery } from "@tanstack/react-query"
import { Text } from "react-native"
import {
  ProductFormScreen,
  useRequireSession,
  type ProductData,
  type ProductFormValues,
} from "@rnw/components-library"
import { fetchProduct, updateMyProduct } from "../../../api/client"

/**
 * Edit one of the caller's products.
 *
 * The product is read through the *public* `GET /products/{id}`: there is no
 * `GET /my-store/products/{id}` route, because a seller editing their own product
 * can already read it publicly, and a second route would only exist to hide a row
 * the marketplace shows anyway.
 */
export default function EditProductRoute() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const session = useRequireSession({
    onSignIn: useCallback(() => router.replace("/login"), []),
  })

  const { data: product, isLoading, error: loadError } = useQuery({
    queryKey: ["product", id],
    queryFn: () => fetchProduct(id),
    enabled: session.status === "authenticated",
  })

  if (session.status === "loading") {
    return <Text className="p-6 text-muted">Checking your session…</Text>
  }
  if (session.status === "anonymous") return null

  return (
    <Editor
      product={product}
      isLoading={isLoading}
      // A product that is not the caller's comes back as a 404, not a 403 — so
      // "not found" and "not yours" render the same screen, which is deliberate.
      error={loadError ?? error}
      isSubmitting={isSubmitting}
      setSubmitting={setIsSubmitting}
      setError={setError}
      onDone={() => router.replace("/my-store")}
      onCancel={() => router.back()}
    />
  )
}

function Editor({
  product,
  isLoading,
  error,
  isSubmitting,
  setSubmitting,
  setError,
  onDone,
  onCancel,
}: {
  product?: ProductData
  isLoading: boolean
  error: Error | null
  isSubmitting: boolean
  setSubmitting: (value: boolean) => void
  setError: (value: Error | null) => void
  onDone: () => void
  onCancel: () => void
}) {
  if (isLoading) return <Text className="p-6 text-muted">Loading product…</Text>
  if (!product) return <Text className="p-6 text-muted">Product not found.</Text>

  const save = async (values: ProductFormValues) => {
    setError(null)
    setSubmitting(true)
    try {
      await updateMyProduct(product.id, values)
      onDone()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error("Could not save the product"))
      setSubmitting(false)
    }
  }

  return (
    <ProductFormScreen
      product={product}
      isSubmitting={isSubmitting}
      error={error}
      onCancel={onCancel}
      onSubmit={save}
    />
  )
}