import { useState, type ComponentType } from "react"
import { Text, type TextProps } from "react-native"
import type { ProductData } from "../../types/Product"
import { ProductFormScreen, type ProductFormValues } from "./ProductFormScreen"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ProductEditorScreenProps = {
  /** Absent while loading, and for a product the caller is not allowed to read. */
  product?: ProductData
  isLoading?: boolean
  /** The *read* failed. A 404 covers both "gone" and "not yours". */
  error?: Error | null
  /** The app's own update call; components-library has no api layer. */
  update: (id: string, values: ProductFormValues) => Promise<ProductData>
  /** Called once `update` resolves. The app decides where that goes. */
  onDone: () => void
  onCancel: () => void
}

/**
 * The edit half of `ProductFormScreen`, for a product the caller already fetched.
 *
 * Owns the save — the submitting flag, the failure message and the point at which
 * the screen is finished — because that sequence was written out twice, once per
 * app, and is the part most worth testing: it needs an injected `update` and no
 * router, so it can be reached from a plain unit test instead of only from a route
 * file on each platform.
 *
 * The fetch stays with the caller, because `fetchProduct` is its transport.
 */
export function ProductEditorScreen({
  product,
  isLoading,
  error,
  update,
  onDone,
  onCancel,
}: ProductEditorScreenProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [saveError, setSaveError] = useState<Error | null>(null)

  if (isLoading) return <ClassNameText className="p-6 text-muted">Loading product…</ClassNameText>
  if (!product) return <ClassNameText className="p-6 text-muted">Product not found.</ClassNameText>

  const save = async (values: ProductFormValues) => {
    setSaveError(null)
    setIsSubmitting(true)
    try {
      await update(product.id, values)
      onDone()
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause : new Error("Could not save the product"))
      setIsSubmitting(false)
    }
  }

  return (
    <ProductFormScreen
      product={product}
      isSubmitting={isSubmitting}
      // A read that failed is reported by the two early returns above, so in
      // practice this is the save's own failure reaching the form.
      error={error ?? saveError}
      onCancel={onCancel}
      onSubmit={save}
    />
  )
}
