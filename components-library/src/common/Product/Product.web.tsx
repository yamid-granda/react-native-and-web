import { memo, type ComponentType } from "react"
import { Image, type ImageProps } from "react-native"
import { ProductCard, type ProductProps } from "./ProductCard"

export type { ProductProps } from "./ProductCard"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameImage = Image as ComponentType<ImageProps & { className?: string }>

// The web half of the platform split: this file is the whole of the
// platform-specific part, and the card itself lives once in ProductCard.tsx.
// See Product.tsx for the native implementation.
export const Product = memo(function Product(props: ProductProps) {
  const { imageUrl, title } = props

  return (
    <ProductCard
      {...props}
      image={
        imageUrl ? (
          <ClassNameImage
            source={{ uri: imageUrl }}
            accessibilityLabel={title}
            resizeMode="cover"
            width={300}
            height={225}
            className="aspect-[4/3] w-full bg-surface-muted"
          />
        ) : null
      }
    />
  )
})
