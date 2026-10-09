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
import { FormField } from "../../common/FormField/FormField"
import { ScreenHeader } from "../../common/ScreenHeader/ScreenHeader"
import { useLocale, useT } from "../../i18n/LocaleContext"
import { en } from "../../i18n/en"
import { es } from "../../i18n/es"
import type { Locale } from "../../i18n/resolveLocale"
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
/** Mirrors `MAX_DESCRIPTION_LENGTH` in `api-rs/src/store/products.rs`. */
const MAX_DESCRIPTION_LENGTH = 4 * 1024
/** Mirrors `MAX_IMAGE_URL_LENGTH` in `api-rs/src/store/products.rs`. */
const MAX_IMAGE_URL_LENGTH = 2 * 1024

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
  const t = useT()
  const { locale } = useLocale()
  const [title, setTitle] = useState(product?.title ?? "")
  const [description, setDescription] = useState(product?.description ?? "")
  const [price, setPrice] = useState(product ? String(product.price) : "")
  const [imageUrl, setImageUrl] = useState(product?.imageUrl ?? "")
  const [stock, setStock] = useState(product ? String(product.stock) : "")
  const [problem, setProblem] = useState<string | null>(null)

  async function submit() {
    const values = parse({ title, description, price, imageUrl, stock }, locale)
    if ("error" in values) {
      setProblem(values.error)
      return
    }
    setProblem(null)
    await onSubmit(values)
  }

  return (
    <ClassNameScrollView testID="product-form-screen" className="flex-1 bg-background">
      <ScreenHeader
        title={isEditing ? t("formEditProduct") : t("formAddProduct")}
        testID="product-form-title"
      />
      <ClassNameView className="gap-4 px-6 pb-6">

        <FormField
          label={t("formTitleLabel")}
          inputTestID="product-title"
          value={title}
          onChangeText={setTitle}
          placeholder={t("formTitlePlaceholder")}
        />

        <FormField
          label={t("formDescriptionLabel")}
          inputTestID="product-description"
          multiline
          value={description}
          onChangeText={setDescription}
          placeholder={t("formDescriptionPlaceholder")}
        />

        <ClassNameView className="flex-row gap-3">
          <FormField
            className="flex-1"
            label={t("formPriceLabel")}
            inputTestID="product-price"
            value={price}
            onChangeText={setPrice}
            placeholder={t("formPricePlaceholder")}
            keyboardType="decimal-pad"
          />
          <FormField
            className="flex-1"
            label={t("formStockLabel")}
            inputTestID="product-stock"
            value={stock}
            onChangeText={setStock}
            placeholder={t("formStockPlaceholder")}
            keyboardType="number-pad"
          />
        </ClassNameView>

        <FormField
          label={t("formImageUrlLabel")}
          inputTestID="product-image-url"
          value={imageUrl}
          onChangeText={setImageUrl}
          placeholder={t("formImageUrlPlaceholder")}
          autoCapitalize="none"
        />

        {problem ? (
          <ClassNameText testID="product-form-error" className="text-sm text-brand">
            {problem}
          </ClassNameText>
        ) : null}
        {error ? (
          <ClassNameText className="text-sm text-foreground">{t("cartError")}: {error.message}</ClassNameText>
        ) : null}

        <Button
          label={submitLabel ?? (isEditing ? t("formSaveChanges") : t("formCreateProduct"))}
          testId="product-form-submit"
          onPress={submit}
          loading={isSubmitting}
        />
        {onCancel ? (
          <Button
            label={t("formCancel")}
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
export function parse(
  fields: {
    title: string
    description: string
    price: string
    imageUrl: string
    stock: string
  },
  locale: Locale = "en",
): ProductFormValues | { error: string } {
  const dict = locale === "es" ? es : en
  const fill = (template: string, vars?: Record<string, string | number>) => {
    let out = template
    if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
    return out
  }
  const title = fields.title.trim()
  if (!title) return { error: dict.formTitleRequired }
  if (title.length > MAX_TITLE_LENGTH) {
    return { error: fill(dict.formTitleTooLong, { max: MAX_TITLE_LENGTH }) }
  }

  const rawPrice = fields.price.trim()
  if (!rawPrice) return { error: dict.formPriceRequired }
  const price = Number(rawPrice)
  // `Number("abc")` is NaN; the empty-string check above is what stops `Number("")`
  // from reading as a valid price of zero.
  if (!Number.isFinite(price)) return { error: dict.formPriceMustBeNumber }
  if (price < 0) return { error: dict.formPriceNegative }

  const rawStock = fields.stock.trim()
  const stock = rawStock === "" ? 0 : Number(rawStock)
  if (!Number.isInteger(stock)) return { error: dict.formStockWhole }
  if (stock < 0) return { error: dict.formStockNegative }

  const description = fields.description.trim()
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return { error: fill(dict.formDescriptionTooLong, { max: MAX_DESCRIPTION_LENGTH }) }
  }

  const imageUrl = fields.imageUrl.trim()
  if (imageUrl.length > MAX_IMAGE_URL_LENGTH) {
    return { error: fill(dict.formImageUrlTooLong, { max: MAX_IMAGE_URL_LENGTH }) }
  }

  return {
    title,
    // Trimmed but never dropped: `""` is how a seller says "clear this", and it is
    // the only spelling that says it. Omitting the key instead would be read as
    // "leave it alone", so a blank field would silently keep its old value while
    // the form reported a successful save. On create the server normalises `""` to
    // `NULL` anyway, so the two paths cost the same body.
    description,
    price,
    imageUrl,
    stock,
  }
}