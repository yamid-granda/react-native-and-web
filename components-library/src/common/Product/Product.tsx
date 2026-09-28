import { memo, type ComponentType } from "react"
import { Pressable, Text, View, type PressableProps, type ViewProps } from "react-native"
import { Image } from "expo-image"
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
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
  onPress,
  className,
}: ProductProps) {
  return (
    <ClassNamePressable
      testID={`product-card-${id}`}
      accessibilityRole="button"
      onPress={onPress}
      className={cn("w-full gap-2 rounded-lg bg-surface p-3 shadow-sm active:opacity-80", className)}
    >
      {imageUrl ? (
        <ClassNameView className="h-32 w-full overflow-hidden rounded-md bg-surface-muted">
          <Image
            source={imageUrl}
            accessibilityLabel={title}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            style={{ width: "100%", height: "100%" }}
          />
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
  )
})
