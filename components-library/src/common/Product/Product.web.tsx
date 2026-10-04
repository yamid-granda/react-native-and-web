import { memo, type ComponentType } from "react"
import { Image, Pressable, Text, View, type ImageProps, type PressableProps, type ViewProps } from "react-native"
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { isWishlisted, useWishlistStore } from "../../business/WishlistScreen/useWishlistStore"
import { Button } from "../Button/Button"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export type ProductProps = ProductData & { onPress?: () => void; className?: string }

export const Product = memo(function Product({
  id,
  title,
  description,
  price,
  currency = "USD",
  imageUrl,
  stock,
  onPress,
  className,
}: ProductProps) {
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
        {imageUrl ? (
          <ClassNameView className="relative h-32 w-full overflow-hidden rounded-md bg-surface-muted">
            <ClassNameImage
              source={{ uri: imageUrl }}
              accessibilityLabel={title}
              resizeMode="cover"
              className="h-32 w-full rounded-md bg-surface-muted"
            />
            {outOfStock ? (
              <ClassNameView className="absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-1">
                <Text className="text-xs font-semibold text-white">Out of stock</Text>
              </ClassNameView>
            ) : null}
          </ClassNameView>
        ) : null}
        {outOfStock && !imageUrl ? (
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
        size="icon"
        variant="secondary"
        testID={`wishlist-toggle-${id}`}
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
