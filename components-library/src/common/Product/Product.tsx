import { memo } from "react"
import { Image } from "expo-image"
import { ProductCard, type ProductProps } from "./ProductCard"

export type { ProductProps } from "./ProductCard"

const FILL = { width: "100%", height: "100%" } as const

// The native half of the platform split: this file is the whole of the
// platform-specific part, and the card itself lives once in ProductCard.tsx.
//
// expo-image (not react-native's Image) for disk/memory-cached images — a
// FlatList-virtualized list mounts/unmounts cards as they scroll in and
// out, so caching avoids re-downloading images already seen. It isn't
// cssInterop-registered anywhere in this repo, so it's sized via plain
// style filling a className'd wrapper instead of taking className itself.
// See Product.web.tsx for the web implementation.
export const Product = memo(function Product(props: ProductProps) {
  const { imageUrl, title } = props

  return (
    <ProductCard
      {...props}
      image={
        imageUrl ? (
          <Image
            source={imageUrl}
            accessibilityLabel={title}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            style={FILL}
          />
        ) : null
      }
    />
  )
})