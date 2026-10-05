import { useState, type ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Button } from "../../common/Button/Button"
import { Input } from "../../common/Input/Input"
import { Label } from "../../common/Label/Label"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

/**
 * What the form collects, with price and stock already parsed.
 *
 * `description` and `imageUrl` are required strings rather than optional ones,
 * and that is the point: a blank field submits `""`, which the server reads as
 * "clear it". Making them optional is what let a deleted description be dropped
 * from the body and silently discarded.
 */
export type ProductFormValues = {
  title: string
  description: string
  price: number
  imageUrl: string
  stock: number
}

export type ProductFormScreenProps = {
  /** Supplying a product turns the form into an edit; omit it to create. */
  product?: ProductData
  submitLabel?: string
  isSubmitting?: boolean
  error?: Error | null
  onSubmit: (values: ProductFormValues) => void | Promise<void>
  onCancel?: () => void
}

const MAX_TITLE_LENGTH = 200

/**
 * Create/edit form for a seller-created product.
 *
 * The submit handler is injected for the same reason `StoreScreen` takes props:
 * both apps own their own mutation, and neither may know the other's routing.
 * `useMyStoreProducts` is the shared piece that actually talks to the API.
 *
 * `imageUrl` is a pasted URL on purpose. Upload would mean object storage, content
 * sniffing and a CDN, which is its own proposal — and a field that accepts
 * anything from the clipboard is a field that has to be validated, not trusted.
 */
export function ProductFormScreen({
  product,
  submitLabel,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: ProductFormScreenProps) {
  const isEditing = Boolean(product)
  const [title, setTitle] = useState(product?.title ?? "")
  const [description, setDescription] = useState(product?.description ?? "")
  const [price, setPrice] = useState(product ? String(product.price) : "")
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "")
  const [stock, setStock] = useState(product ? String(product.stock) : "")
  const [problem, setProblem] = useState<string | null>(null)

  async function submit() {
    const values = parse({ title, description, price, imageUrl, stock })
    if ("error" in values) {
      setProblem(values.error)
      return
    }
    setProblem(null)
    await onSubmit(values)
  }

  return (
    <ClassNameScrollView testID="product-form-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">
          {isEditing ? "Edit product" : "Add product"}
        </ClassNameText>

        <ClassNameView className="gap-1">
          <Label htmlFor="product-title">Title</Label>
          <Input
            inputTestID="product-title"
            value={title}
            onChangeText={setTitle}
            placeholder="Leather Weekender Bag"
          />
        </ClassNameView>

        <ClassNameView className="gap-1">
          <Label htmlFor="product-description">Description</Label>
          <Input
            inputTestID="product-description"
            multiline
            value={description}
            onChangeText={setDescription}
            placeholder="What should a shopper know about it?"
          />
        </ClassNameView>

        <ClassNameView className="flex-row gap-3">
          <ClassNameView className="flex-1 gap-1">
            <Label htmlFor="product-price">Price</Label>
            <Input
              inputTestID="product-price"
              value={price}
              onChangeText={setPrice}
              placeholder="24.99"
              keyboardType="decimal-pad"
            />
          </ClassNameView>
          <ClassNameView className="flex-1 gap-1">
            <Label htmlFor="product-stock">Stock</Label>
            <Input
              inputTestID="product-stock"
              value={stock}
              onChangeText={setStock}
              placeholder="0"
              keyboardType="number-pad"
            />
          </ClassNameView>
        </ClassNameView>

        <ClassNameView className="gap-1">
          <Label htmlFor="product-image-url">Image URL</Label>
          <Input
            inputTestID="product-image-url"
            value={imageUrl}
            onChangeText={setImageUrl}
            placeholder="https://…"
            autoCapitalize="none"
          />
        </ClassNameView>

        {problem ? (
          <ClassNameText testID="product-form-error" className="text-sm text-brand">
            {problem}
          </ClassNameText>
        ) : null}
        {error ? (
          <ClassNameText className="text-sm text-foreground">Error: {error.message}</ClassNameText>
        ) : null}

        <Button
          label={submitLabel ?? (isEditing ? "Save changes" : "Create product")}
          testId="product-form-submit"
          onPress={submit}
          loading={isSubmitting}
        />
        {onCancel ? (
          <Button
            label="Cancel"
            testId="product-form-cancel"
            onPress={onCancel}
            className="bg-surface-muted"
          />
        ) : null}
      </ClassNameView>
    </ClassNameScrollView>
  )
}

/**
 * Parses the raw strings, or explains what is wrong with them.
 *
 * Deliberately mirrors the server's rules (api-rs/src/handlers/my_store.rs)
 * rather than replacing them: a 400 from the server for something this could
 * have caught is a worse experience, and a second set of rules is a second thing
 * to keep correct. The server stays the authority.
 */
export function parse(fields: {
  title: string
  description: string
  price: string
  imageUrl: string
  stock: string
}): ProductFormValues | { error: string } {
  const title = fields.title.trim()
  if (!title) return { error: "Title is required" }
  if (title.length > MAX_TITLE_LENGTH) {
    return { error: `Title must be at most ${MAX_TITLE_LENGTH} characters` }
  }

  const rawPrice = fields.price.trim()
  if (!rawPrice) return { error: "Price is required" }
  const price = Number(rawPrice)
  // `Number("abc")` is NaN; the empty-string check above is what stops `Number("")`
  // from reading as a valid price of zero.
  if (!Number.isFinite(price)) return { error: "Price must be a number" }
  if (price < 0) return { error: "Price must not be negative" }

  const rawStock = fields.stock.trim()
  const stock = rawStock === "" ? 0 : Number(rawStock)
  if (!Number.isInteger(stock)) return { error: "Stock must be a whole number" }
  if (stock < 0) return { error: "Stock must not be negative" }

  return {
    title,
    // Trimmed but never dropped: `""` is how a seller says "clear this", and it is
    // the only spelling that says it. Omitting the key instead would be read as
    // "leave it alone", so a blank field would silently keep its old value while
    // the form reported a successful save. On create the server normalises `""` to
    // `NULL` anyway, so the two paths cost the same body.
    description: fields.description.trim(),
    price,
    imageUrl: fields.imageUrl.trim(),
    stock,
  }
}