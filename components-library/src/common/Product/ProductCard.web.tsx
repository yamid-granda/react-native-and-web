import { memo, type ComponentType, type ReactNode } from "react"
import { Pressable, Text, View, type PressableProps, type ViewProps } from "react-native"
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { isWishlisted, useWishlistStore } from "../../business/WishlistScreen/useWishlistStore"
import { Button } from "../Button/Button"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export type ProductProps = ProductData & { onPress?: () => void; className?: string }

/**
 * The web half of the platform split: this file is the whole of the
 * platform-specific part, and the card itself lives once in ProductCard.tsx.
 * See Product.tsx for the native implementation.
 *
 * On web, the card is wrapped in a Next.js `<Link>` so crawlers can discover
 * product pages by following links from the marketplace list. The native
 * adapter uses `Pressable` + `onPress` instead.
 */
export const ProductCard = memo(function ProductCard({
  image,
  id,
  title,
  description,
  price,
  currency = "USD",
  stock,
  onPress,
  className,
}: ProductCardProps) {
  const outOfStock = stock === 0
  const wishlisted = useWishlistStore((state) => isWishlisted(state.ids, id))
  const toggleItem = useWishlistStore((state) => state.toggleItem)

  return (
    // A plain View, not a second button, wraps the card content and the
    // wishlist toggle as siblings: both render a real <button> on web
    // (accessibilityRole="button" via propsToAccessibilityComponent), and
    // nesting one <button> inside another is invalid HTML that breaks
    // hydration.
    <ClassNameView className={cn("relative w-full", className)}>
      <ClassNamePressable
        testID={`product-card-${id}`}
        accessibilityRole="button"
        onPress={onPress}
        className={cn(
          "w-full gap-2 rounded-lg bg-surface p-3 shadow-sm active:opacity-80",
          outOfStock && "opacity-70",
        )}
      >
        {image ? (
          <ClassNameView className="relative h-32 w-full overflow-hidden rounded-md bg-surface-muted">
            {image}
            {outOfStock ? (
              <ClassNameView className="absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-1">
                <Text className="text-xs font-semibold text-white">Out of stock</Text>
              </ClassNameView>
            ) : null}
          </ClassNameView>
        ) : null}
        {outOfStock && !image ? (
          <ClassNameView className="self-start rounded-full bg-foreground/80 px-2 py-1">
            <Text className="text-xs font-semibold text-white">Out of stock</Text>
          </ClassNameView>
        ) : null}
        <Text numberOfLines={1} className="text-sm font-semibold text-foreground">
          {title}
        </Text>
        {description ? (
          <Text numberOfLines={2} className="text-xs text-muted">
            {description}
          </Text>
        ) : null}
        <Text className="text-base font-bold text-brand">{formatPrice(price, currency)}</Text>
      </ClassNamePressable>
      <Button
        label={wishlisted ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        variant="secondary"
        testId={`wishlist-toggle-${id}`}
        // The id, not a snapshot of this card. This line used to hand the
        // wishlist a hand-built `ProductData` that silently dropped `storeId` /
        // `storeName`, so wishlisting from a card and wishlisting from the detail
        // page persisted two different things. A callee that needs one field
        // cannot be handed a wrong one.
        onPress={() => toggleItem(id)}
        className="absolute right-2 top-2"
      >
        <HeartIcon size={18} filled={wishlisted} className={wishlisted ? "text-brand" : "text-muted"} />
      </Button>
    </ClassNameView>
  )
})

export type ProductCardProps = ProductProps & {
  /**
   * The already-constructed image for this product, or `null` when it has
   * none. Falsy also means "no image", which is what decides whether the
   * out-of-stock badge sits over the image or on its own.
   */
  image?: ReactNode
}
