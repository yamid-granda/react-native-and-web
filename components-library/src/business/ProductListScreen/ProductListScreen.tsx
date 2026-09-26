import { useState, type ComponentType } from "react"
import {
  ScrollView,
  Text,
  TextInput,
  View,
  type ScrollViewProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from "react-native"
import { Product } from "../../common/Product/Product"
import type { ProductData } from "../../types/Product"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameScrollView = ScrollView as ComponentType<ScrollViewProps & { className?: string }>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>
const ClassNameTextInput = TextInput as ComponentType<TextInputProps & { className?: string }>

export type ProductListScreenProps = {
  products: ProductData[]
  isLoading?: boolean
  error?: Error | null
  onSelectProduct?: (id: string) => void
}

// same substring-match approach as IconsGallery's search
function matchesQuery(query: string, product: ProductData) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return (
    product.title.toLowerCase().includes(normalized) ||
    (product.description?.toLowerCase().includes(normalized) ?? false)
  )
}

export function ProductListScreen({
  products,
  isLoading,
  error,
  onSelectProduct,
}: ProductListScreenProps) {
  const [query, setQuery] = useState("")

  const results = products.filter((product) => matchesQuery(query, product))

  return (
    <ClassNameScrollView testID="product-list-screen" className="flex-1 bg-background">
      <ClassNameView className="gap-4 p-6">
        <ClassNameText className="text-2xl font-semibold text-foreground">
          Marketplace
        </ClassNameText>
        <ClassNameTextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search products..."
          accessibilityLabel="Search products"
          className="rounded-lg border border-surface-muted bg-surface px-3 py-2 text-sm text-foreground"
        />
        {isLoading ? <ClassNameText className="text-muted">Loading products…</ClassNameText> : null}
        {error ? (
          <ClassNameText className="text-foreground">Error: {error.message}</ClassNameText>
        ) : null}
        {!isLoading && !error && products.length === 0 ? (
          <ClassNameText className="text-muted">No products yet.</ClassNameText>
        ) : null}
        {!isLoading && !error && products.length > 0 && results.length === 0 ? (
          <ClassNameText className="text-muted">No products match "{query}".</ClassNameText>
        ) : null}
        <ClassNameView className="flex-row flex-wrap gap-4">
          {results.map((product) => (
            <Product key={product.id} {...product} onPress={() => onSelectProduct?.(product.id)} />
          ))}
        </ClassNameView>
      </ClassNameView>
    </ClassNameScrollView>
  )
}
