import type { ComponentType } from "react"
import { Image, Pressable, Text, type ImageProps, type PressableProps } from "react-native"
import { cn } from "../../utils/cn"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>

export type ProductProps = {
  id: string
  title: string
  description?: string
  price: number
  currency?: string
  imageUrl?: string
  onPress?: () => void
  className?: string
}

export function Product({
  title,
  description,
  price,
  currency = "USD",
  imageUrl,
  onPress,
  className,
}: ProductProps) {
  const formattedPrice = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(price)

  return (
    <ClassNamePressable
      accessibilityRole="button"
      onPress={onPress}
      className={cn("w-48 gap-2 rounded-lg bg-white p-3 shadow-sm active:opacity-80", className)}
    >
      {imageUrl ? (
        <ClassNameImage
          source={{ uri: imageUrl }}
          accessibilityLabel={title}
          resizeMode="cover"
          className="h-32 w-full rounded-md bg-zinc-100"
        />
      ) : null}
      <Text numberOfLines={1} className="text-sm font-semibold text-zinc-900">
        {title}
      </Text>
      {description ? (
        <Text numberOfLines={2} className="text-xs text-zinc-500">
          {description}
        </Text>
      ) : null}
      <Text className="text-base font-bold text-brand">{formattedPrice}</Text>
    </ClassNamePressable>
  )
}
