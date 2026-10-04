import type { ComponentType } from "react"
import { Text, type TextProps } from "react-native"
import type { ProductData } from "../../types/Product"
import { ProductFormScreen, type ProductFormValues } from "./ProductFormScreen"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ProductEditorScreenProps = {
  /** Absent while the read is in flight, and also when the read 404s. */
  product?: ProductData
  isLoading: boolean
  /** A failed read, or a failed save once one has happened. */
  error: Error | null
  isSubmitting: boolean
  setSubmitting: (value: boolean) => void
  setError: (value: Error | null) => void
  /** Injected so this screen needs no api layer of its own. */
  update: (id: string, values: Partial<ProductFormValues>) => Promise<ProductData>
  /** Called after a successful save. */
  onDone: () => void
  onCancel: () => void
}

/**
 * The seller's edit form, once the product has been read.
 *
 * A sibling of `ProductFormScreen` for the same reason `StoreScreen` exists: both
 * apps own their own transport, so this takes the mutation as a function and
 * renders the shared form rather than fetching anything itself. `update` has the
 * same signature as `MyStoreApi["update"]` so a route can pass its own
 * `updateMyProduct` straight in.
 *
 * "Not found" and "not yours" are the same screen on purpose: the api answers a
 * product that isn't the caller's with a 404, not a 403, and telling a seller
 * that a product exists but belongs to someone else is not worth the extra branch.
 */
export function ProductEditorScreen({
  product,
  isLoading,
  error,
  isSubmitting,
  setSubmitting,
  setError,
  update,
  onDone,
  onCancel,
}: ProductEditorScreenProps) {
  if (isLoading) {
    return <ClassNameText className="p-6 text-muted">Loading product…</ClassNameText>
  }
  if (!product) return <ClassNameText className="p-6 text-muted">Product not found.</ClassNameText>

  const save = async (values: ProductFormValues) => {
    setError(null)
    setSubmitting(true)
    try {
      await update(product.id, values)
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