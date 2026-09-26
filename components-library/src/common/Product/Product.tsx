import type { ComponentType } from "react"
import { Image, Pressable, Text, type ImageProps, type PressableProps } from "react-native"
import { cn } from "../../utils/cn"
import { formatPrice } from "../../utils/formatPrice"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>

export type ProductProps = ProductData & { onPress?: () => void; className?: string }

export function Product({
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
      className={cn("w-48 gap-2 rounded-lg bg-surface p-3 shadow-sm active:opacity-80", className)}
    >
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
}
