import { memo, type ComponentType } from "react"
import { Pressable, Text, View, type PressableProps, type ViewProps } from "react-native"
import { Image } from "expo-image"
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { isWishlisted, useWishlistStore } from "../../business/WishlistScreen/useWishlistStore"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export type ProductProps = ProductData & { onPress?: () => void; className?: string }

// expo-image (not react-native's Image) for disk/memory-cached images — a
// FlatList-virtualized list mounts/unmounts cards as they scroll in and
// out, so caching avoids re-downloading images already seen. It isn't
// cssInterop-registered anywhere in this repo, so it's sized via plain
// style filling a className'd wrapper instead of taking className itself.
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
  const wishlisted = useWishlistStore((state) => isWishlisted(state.items, id))
  const toggleItem = useWishlistStore((state) => state.toggleItem)

  return (
    // A plain View, not a second Pressable, wraps the card content and the
    // wishlist toggle as siblings: accessibilityRole="button" renders a
    // real <button> on web (propsToAccessibilityComponent), and nesting
    // one <button> inside another is invalid HTML that breaks hydration.
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
            <Image
              source={imageUrl}
              accessibilityLabel={title}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
              style={{ width: "100%", height: "100%" }}
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
      <ClassNamePressable
        testID={`wishlist-toggle-${id}`}
        accessibilityRole="button"
        accessibilityLabel={wishlisted ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        onPress={() => toggleItem({ id, title, description, price, currency, imageUrl })}
        className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-surface/80"
      >
        <HeartIcon size={18} filled={wishlisted} className={wishlisted ? "text-brand" : "text-muted"} />
      </ClassNamePressable>
    </ClassNameView>
  )
})
