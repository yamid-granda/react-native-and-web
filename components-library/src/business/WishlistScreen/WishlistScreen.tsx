import type { ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { formatPrice } from "../../utils/formatPrice"
import { Button } from "../../common/Button/Button"
import { useCartStore } from "../CartScreen/useCartStore"
import { useProductLookup, type FetchProductsByIds } from "../ProductLookup/useProductLookup"
import { useWishlistStore } from "./useWishlistStore"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type WishlistScreenProps = {
  /** Props in, no fetching here — see `StoreScreen` for why. */
  fetchProductsByIds: FetchProductsByIds
}

export function WishlistScreen({ fetchProductsByIds }: WishlistScreenProps) {
  const ids = useWishlistStore((state) => state.ids)
  const removeItem = useWishlistStore((state) => state.removeItem)
  const addItem = useCartStore((state) => state.addItem)

  const { byId, missing, isLoading, error } = useProductLookup(ids, fetchProductsByIds)

  // Joined against the store's order. `product` here is the *live* product, not
  // the snapshot the wishlist used to hold — which is why "Add to Cart" can no
  // longer carry a price from weeks ago into the cart.
  const products = ids.flatMap((id) => {
    const product = byId[id]
    return product ? [product] : []
  })

  // An id that no longer resolves is a saved item that cannot come back. It is
  // said out loud rather than silently shortening the list, and removable in one
  // press — an id that renders nothing is otherwise impossible to clear.
  const unavailableNotice =
    missing.length > 0 ? (
      <ClassNameView className="gap-2">
        <ClassNameText testID="wishlist-missing" className="text-sm text-muted">
          {missing.length === 1
            ? "1 saved item is no longer available."
            : `${missing.length} saved items are no longer available.`}
        </ClassNameText>
        <Button
          label="Remove unavailable items"
          testId="wishlist-remove-unavailable"
          variant="secondary"
          className="self-start"
          onPress={() => missing.forEach(removeItem)}
        />
      </ClassNameView>
    ) : null

  return (
    <ClassNameScrollView testID="wishlist-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">Wishlist</ClassNameText>
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}
        {unavailableNotice}
        {/* In this order, and the order is the point: a lookup that failed is
            reported above and must not *also* claim the wishlist is empty, and a
            lookup still in flight has not answered yet — only a settled answer may
            say "empty". Checking `products.length` first got both wrong: an error
            rendered the empty state beside itself, and a pending list flashed
            "empty" before its first paint. */}
        {error ? null : isLoading ? (
          <ClassNameText className="text-muted">Loading your wishlist…</ClassNameText>
        ) : products.length === 0 ? (
          <ClassNameText className="text-muted">Your wishlist is empty.</ClassNameText>
        ) : (
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
                  </ClassNameText>
                </ClassNameView>
                <Button
                  label="Add to Cart"
                  testId={`wishlist-add-to-cart-${product.id}`}
                  onPress={() => addItem(product.id)}
                />
                <Button
                  label="Remove"
                  variant="secondary"
                  accessibilityLabel={`Remove ${product.title} from wishlist`}
                  testId={`wishlist-remove-${product.id}`}
                  onPress={() => removeItem(product.id)}
                />
              </ClassNameView>
            ))}
          </ClassNameView>
        )}
      </ClassNameView>
    </ClassNameScrollView>
  )
}
