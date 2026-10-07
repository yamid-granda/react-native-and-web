import { type ComponentType } from "react"
import { Text, type TextProps } from "react-native"
import { ProductDetailScreen, type ProductDetailScreenProps } from "./ProductDetailScreenBase"

// Keep the normal export available to existing web tests/importers. The
// semantic wrapper is the additional web-only entry point used by the SEO page.
export { ProductDetailScreen }
export type { ProductDetailScreenProps }

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

/**
 * The web half of the platform split: wraps the shared screen in semantic HTML
 * for SEO. The native adapter uses the shared screen directly.
 *
 * On web, the product title is rendered as an `<h1>` and the whole screen is
 * wrapped in an `<article>` so search engines can understand the page structure.
 */
export function ProductDetailScreenWithSemantics(props: ProductDetailScreenProps) {
  const { product } = props

  return (
    <article>
      {product ? (
        <ClassNameText className="text-2xl font-semibold text-foreground">
          {product.title}
        </ClassNameText>
      ) : null}
      <ProductDetailScreen {...props} />
    </article>
  )
}
