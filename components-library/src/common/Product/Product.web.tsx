import { memo, type ComponentType } from "react"
import { Image, Pressable, Text, type ImageProps, type PressableProps } from "react-native"
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
import { HeartIcon } from "../../icons/HeartIcon/HeartIcon"
import { isWishlisted, useWishlistStore } from "../../business/WishlistScreen/useWishlistStore"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>

export type ProductProps = ProductData & { onPress?: () => void; className?: string }

export const Product = memo(function Product({
  id,
  title,
  description,
  price,
  currency = "USD",
  imageUrl,
  onPress,
  className,
}: ProductProps) {
  const wishlisted = useWishlistStore((state) => isWishlisted(state.items, id))
  const toggleItem = useWishlistStore((state) => state.toggleItem)

  return (
    <ClassNamePressable
      testID={`product-card-${id}`}
      accessibilityRole="button"
      onPress={onPress}
      className={cn("w-full gap-2 rounded-lg bg-surface p-3 shadow-sm active:opacity-80", className)}
    >
      <ClassNamePressable
        testID={`wishlist-toggle-${id}`}
        accessibilityRole="button"
        accessibilityLabel={wishlisted ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        onPress={(e) => {
          // stops the press reaching the card's own onPress via DOM click
          // bubbling on web (see Drawer.tsx); native already scopes it via
          // the responder system, so this is a no-op there.
          e.stopPropagation()
          toggleItem({ id, title, description, price, currency, imageUrl })
        }}
        className="absolute right-2 top-2 z-10 h-8 w-8 items-center justify-center rounded-full bg-surface/80"
      >
        <HeartIcon size={18} filled={wishlisted} className={wishlisted ? "text-brand" : "text-muted"} />
      </ClassNamePressable>
      {imageUrl ? (
        <ClassNameImage
          source={{ uri: imageUrl }}
          accessibilityLabel={title}
          resizeMode="cover"
          className="h-32 w-full rounded-md bg-surface-muted"
        />
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
  )
})
