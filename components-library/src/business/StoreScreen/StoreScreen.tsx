import type { ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Button } from "../../common/Button/Button"
import { formatPrice } from "../../utils/formatPrice"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type StoreScreenProps = {
  storeName: string
  products: ProductData[]
  isLoading?: boolean
  error?: Error | null
  /** Set while a create, edit or delete is in flight. */
  isMutating?: boolean
  onCreate: () => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * My Store: the seller's own product list.
 *
 * A sibling of `CartScreen` and `WishlistScreen` — props in, no fetching here.
 * The reason is the same for all three: this package has no router, so a screen
 * that reached for one would need it injected per platform, and the alternative
 * (a near-copy per app) is worse.
 */
export function StoreScreen({
  storeName,
  products,
  isLoading,
  error,
  isMutating,
  onCreate,
  onEdit,
  onDelete,
}: StoreScreenProps) {
  return (
    <ClassNameScrollView testID="store-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">{storeName}</ClassNameText>

        {isLoading ? <ClassNameText className="text-muted">Loading your products…</ClassNameText> : null}
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}

        {!isLoading && !error && products.length === 0 ? (
          <ClassNameText className="text-muted">
            You have no products yet. Add one and it shows up in the marketplace next to everyone
            else&apos;s.
          </ClassNameText>
        ) : null}

        {products.length > 0 ? (
          <ClassNameView className="gap-3">
            {products.map((product) => (
              <ClassNameView
                key={product.id}
                className="flex-row items-center justify-between gap-3 rounded-lg bg-surface p-3"
              >
                <ClassNameView className="flex-1 gap-1">
                  <ClassNameText className="text-sm font-semibold text-foreground">
                    {product.title}
                  </ClassNameText>
                  <ClassNameText className="text-xs text-muted">
                    {formatPrice(product.price, product.currency)}
                    {product.stock === 0 ? " · out of stock" : ` · ${product.stock} in stock`}
                  </ClassNameText>
                </ClassNameView>
                <Button
                  label="Edit"
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`Edit ${product.title}`}
                  testId={`store-edit-${product.id}`}
                  onPress={() => onEdit(product.id)}
                />
                <Button
                  label="Delete"
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`Delete ${product.title}`}
                  testId={`store-delete-${product.id}`}
                  disabled={isMutating}
                  onPress={() => onDelete(product.id)}
                />
              </ClassNameView>
            ))}
          </ClassNameView>
        ) : null}

        <Button
          label="Add product"
          testId="store-add-product"
          onPress={onCreate}
          disabled={isMutating}
        />
      </ClassNameView>
    </ClassNameScrollView>
  )
}