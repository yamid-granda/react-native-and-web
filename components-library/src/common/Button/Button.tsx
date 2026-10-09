import type { ComponentType, ReactNode } from "react"
import { Pressable, Text, type PressableProps, type TextProps } from "react-native"
import { cn } from "../../utils/cn"

// nativewind's className typing doesn't cover PressableProps and doesn't
// merge reliably across workspace packages (README), so cast locally.
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

/**
 * The only button looks in the repo, and there are only two. Every app button
 * must pick one of these; a third is a design decision, not a local one — write
 * a proposal under `improve-proposals/` and get it agreed before it lands here
 * (`.agents/rules/button-variants.md`).
 *
 * There are deliberately no size variants: every button is the one default size.
 * Sizes are a proposal away, not an inline union away.
 */
export type ButtonVariant =
  /** Filled brand. The one primary call-to-action per view. */
  | "primary"
  /** Bordered, surface-filled. Everything that isn't the primary action. */
  | "secondary"

// Height comes from the shared `h-control` token (tailwind-preset.cjs) and is
// deliberately the only height any button may use, so buttons and inputs line
// up everywhere. Horizontal padding lives per variant so `secondary` can share
// `Input`'s `px-3` finish while `primary` keeps the default `px-4` size.
const BUTTON_BASE_CLASSNAME = "h-control items-center justify-center"

type ButtonStyle = { container: string; label: string }

const variantStyle: Record<ButtonVariant, ButtonStyle> = {
  primary: {
    container: "rounded-lg bg-brand px-4 active:bg-brand-dark",
    label: "text-base font-semibold leading-6 text-white",
  },
  secondary: {
    // Mirrors `Input`'s wrapper + inner text: same `h-control` height (from the
    // base above), same `px-3` padding, same border/fill/text tokens, and the
    // same `text-base font-normal leading-6` label so a secondary button beside
    // a field reads as one control finish.
    container:
      "rounded-lg border border-control-border bg-control-bg px-3 active:bg-surface-muted",
    label: "text-base font-normal leading-6 text-control-text",
  },
}

/**
 * The variant list, derived from `variantStyle` rather than written out beside
 * it so the two cannot drift. Because `variantStyle` is a `Record` keyed by the
 * whole union, adding a variant to the type *forces* a new entry here, and
 * `Button.variants.test.ts` pins the result to the approved list — so a new look
 * can't reach the app without that proposal landing first.
 */
export const BUTTON_VARIANTS = Object.keys(variantStyle) as ButtonVariant[]

export type ButtonProps = {
  /**
   * The button's visible text and its accessible name. Required even for icon
   * buttons, so every button in the app says what it is. The test id is a
   * separate, required prop — see `testId` below.
   */
  label: string
  /**
   * Replaces the label's text node, for icon-only buttons. Not wrapped in a
   * `Text` here on purpose: callers pass native-safe children themselves (an
   * icon, or a `<Text>` around a "+"/"-" glyph). Without them the label is
   * rendered as normal, so a button that was meant to be icon-only shows its
   * text instead of producing an invisible control.
   */
  children?: ReactNode
  onPress?: () => void
  variant?: ButtonVariant
  /**
   * Greys the button out and stops it firing. `Pressable` already knows about
   * `disabled`; what it does not know is that the label has to look inert too.
   */
  disabled?: boolean
  /**
   * Swaps the label for "…" while a mutation is in flight.
   *
   * Not a spinner: the shared button has no icon slot, and a save button whose
   * label says what it is about to do beats one that disappears. Pair it with
   * `disabled` at the call site — a loading button that can still be pressed
   * twice is worse than one that cannot.
   */
  loading?: boolean
  /**
   * Announces this button as the current one of a set, and drives `aria-selected`.
   *
   * It carries no styling of its own: the two variants above are the only looks
   * there are, so a caller that wants the selection *visible* picks the variant
   * that shows it (see `ProductFilterControls`, where the current sort is
   * `primary` and the rest are `secondary`). This is the announcement half only,
   * for a control that toggles between variants rather than a look of its own.
   */
  selected?: boolean
  /** Overrides `label` as the accessible name when the visible text is a poor one. */
  accessibilityLabel?: string
  /**
   * This button's test id, forwarded to the platform's `testID`. Required and
   * never derived from `label` — see the README's "Architecture boundaries" for
   * why a derived id is not usable.
   */
  testId: string
  className?: string
  labelClassName?: string
}

export function Button({
  label,
  children,
  onPress,
  variant = "primary",
  disabled,
  loading,
  selected,
  accessibilityLabel,
  testId,
  className,
  labelClassName,
}: ButtonProps) {
  const inert = Boolean(disabled || loading)
  const style = variantStyle[variant]
  // Icon-only buttons (custom `children`, no text label) drop the horizontal
  // padding and pin the width to the same `control` token as the height, so
  // width and height stay equal instead of stretching into a pill.
  const iconOnly = children != null

  return (
    <ClassNamePressable
      testID={testId}
      accessibilityRole="button"
      // The visible label becomes "…" while loading, which would leave a screen
      // reader with nothing to announce — so the name is carried explicitly and
      // the busy state is announced alongside it.
      accessibilityLabel={accessibilityLabel ?? label}
      // `aria-busy` rather than `accessibilityState.busy`: react-native-web only
      // reads the aria-* spelling, and RN 0.71+ accepts it natively too. Verified
      // in react-native-web's createDOMProps — `accessibilityState.busy` is
      // dropped on web, so using it here would announce nothing.
      aria-busy={Boolean(loading)}
      // `disabled` needs no `accessibilityState`: RN's own Pressable folds it in
      // (Pressable.js), which is also what renders `disabled` on the web <button>.
      // `aria-selected` is passed the same way, because RNW drops the
      // accessibilityState spelling of it too. Left undefined unless the caller
      // opts in, so an ordinary button never claims to be part of a selection.
      aria-selected={selected}
      disabled={inert}
      onPress={onPress}
      className={cn(BUTTON_BASE_CLASSNAME, style.container, iconOnly && "w-control px-0", inert && "opacity-50", className)}
    >
      {children ?? (
        <ClassNameText className={cn(style.label, labelClassName)}>
          {loading ? "…" : label}
        </ClassNameText>
      )}
    </ClassNamePressable>
  )
}
