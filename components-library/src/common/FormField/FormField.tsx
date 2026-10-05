import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import { cn } from "../../utils/cn"
import { Input, type InputProps } from "../Input/Input"
import { Label } from "../Label/Label"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export type FormFieldProps = {
  /**
   * The caption above the field. Also the field's accessible name, so the two
   * cannot drift apart.
   */
  label: string
  /** An error message; replaces the caption, as `Label` has always done. */
  error?: string
  /**
   * Styles the column holding the caption and the field — not the field's own
   * box, which stays `Input`'s business. The same `className`-styles-the-root
   * convention `Label` and `Input` already follow.
   */
  className?: string
} & Omit<InputProps, "className">

/**
 * A caption, its error, and the field it names — one owner for the association.
 *
 * `Label` cannot do this alone, and that is why `Label` no longer claims to. RN
 * has no `label`/`for`, so a field's name has to be handed to the `TextInput`
 * itself; an `accessibilityLabel` set on the caption's `Text` labels the caption
 * instead, and the field beside it — the thing the user is actually typing into
 * — has no name at all. Composition is the only place that can reach both, and
 * deriving the name from the same string that renders the caption is what makes
 * the pairing impossible to get wrong.
 *
 * Reach for this rather than pairing `Label` and `Input` by hand. `SearchInput`
 * is the one deliberate exception: it is a field with no caption.
 */
export function FormField({
  label,
  error,
  className,
  inputTestID,
  ...inputProps
}: FormFieldProps) {
  return (
    <ClassNameView className={cn("gap-1", className)}>
      <Label error={error}>{label}</Label>
      {/* `inputProps` last, so a caller can still override the derived name
          deliberately; `inputTestID` is forwarded explicitly because it is a
          field's own selector rather than something to pass through blindly. */}
      <Input inputTestID={inputTestID} accessibilityLabel={label} {...inputProps} />
    </ClassNameView>
  )
}
