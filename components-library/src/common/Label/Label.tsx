import type { ComponentType } from "react"
import { Text, type TextProps } from "react-native"
import { cn } from "../../utils/cn"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type LabelProps = {
  children: string
  /** An error message under the same field; rendered in the danger colour. */
  error?: string
  className?: string
}

/**
 * The caption above a form field — the caption only.
 *
 * This deliberately does not name the field. An `accessibilityLabel` here would
 * label this `Text`, not the `TextInput` a caller renders beside it, so the
 * caption would announce itself ("Email label") while the field the seller is
 * typing into stayed anonymous. `FormField` is what pairs the two, because it is
 * the only place that can reach both nodes.
 *
 * Reach for `FormField` rather than pairing this with an `Input` by hand.
 */
export function Label({ children, error, className }: LabelProps) {
  return (
    <ClassNameText
      className={cn("text-xs font-semibold uppercase tracking-wide text-muted", className)}
    >
      {error ? <ClassNameText className="text-brand">{error}</ClassNameText> : children}
    </ClassNameText>
  )
}
