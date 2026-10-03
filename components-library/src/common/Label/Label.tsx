import type { ComponentType } from "react"
import { Text, type TextProps } from "react-native"
import { cn } from "../../utils/cn"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type LabelProps = {
  children: string
  /**
   * The `Input` this labels. Wired as `accessibilityLabel` on the field so a
   * screen reader announces something meaningful — the placeholder disappears
   * as soon as the user types, and "text field" alone tells them nothing.
   */
  htmlFor?: string
  /** An error message under the same field; rendered in the danger colour. */
  error?: string
  className?: string
}

/**
 * The caption above a form field.
 *
 * Exists because a form with three fields needs one, and RN's `Text` already
 * does the job — what was missing was the association with its input and a
 * consistent error style, both of which every form in the app would otherwise
 * re-implement.
 */
export function Label({ children, htmlFor, error, className }: LabelProps) {
  return (
    <ClassNameText
      accessibilityRole="text"
      // `accessibilityLabel` rather than `htmlFor`: RN has no label/for, and
      // react-native-web renders this Text, so the id has to travel as an
      // accessibility label for the association to survive on both platforms.
      accessibilityLabel={htmlFor ? `${children} label` : undefined}
      className={cn("text-xs font-semibold uppercase tracking-wide text-muted", className)}
    >
      {error ? <ClassNameText className="text-brand">{error}</ClassNameText> : children}
    </ClassNameText>
  )
}