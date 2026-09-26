import type { ComponentType } from "react"
import {
  ScrollView,
  Text,
  View,
  type ScrollViewProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Product } from "../../common/Product/Product"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ProductListScreenProps = {
  products: ProductData[]
  isLoading?: boolean
  error?: Error | null
  onSelectProduct?: (id: string) => void
}

export function ProductListScreen({
  products,
  isLoading,
  error,
  onSelectProduct,
}: ProductListScreenProps) {
  return (
    <ClassNameScrollView testID="product-list-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">
          Marketplace
        </ClassNameText>
        {isLoading ? <ClassNameText className="text-muted">Loading products…</ClassNameText> : null}
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}
        {!isLoading && !error && products.length === 0 ? (
          <ClassNameText className="text-muted">No products yet.</ClassNameText>
        ) : null}
        <ClassNameView className="flex-row flex-wrap gap-4">
          {products.map((product) => (
            <Product key={product.id} {...product} onPress={() => onSelectProduct?.(product.id)} />
          ))}
        </ClassNameView>
      </ClassNameView>
    </ClassNameScrollView>
  )
}
