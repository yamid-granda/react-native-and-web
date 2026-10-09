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
 */
export type ButtonVariant =
  /** Filled brand. The one primary call-to-action per view. */
  | "primary"
  /** Bordered, surface-filled. Everything that isn't the primary action. */
  | "secondary"

/**
 * Density for tight rows such as the marketplace filters
 * (`improve-proposals/2026-10-09-button-input-sm.md`). `md` is the default
 * everywhere (`h-control` height, `text-base leading-6` label); `sm` is the
 * compact filter density (`h-8` height, `text-sm leading-5` label, trimmed
 * horizontal padding).
 */
export type ButtonSize = "md" | "sm"

// The default height comes from the shared `h-control` token
// (tailwind-preset.cjs) so default buttons and inputs line up everywhere.
// `sm` is the one deliberate exception: `h-8` for dense filter rows (see the
// proposal). Horizontal padding lives in `sizePaddingClassName` below.
const BUTTON_BASE_CLASSNAME = "items-center justify-center"

/**
 * Height per size. `md` is the shared control token; `sm` steps down to `h-8`
 * (32px) so filter chips and fields read as compact next to the 44px default.
 */
const sizeHeightClassName: Record<ButtonSize, string> = {
  md: "h-control",
  sm: "h-8",
}

type ButtonStyle = { container: string; label: string }

const variantStyle: Record<ButtonVariant, ButtonStyle> = {
  primary: {
    container: "rounded-lg bg-brand active:bg-brand-dark",
    label: "font-semibold text-white",
  },
  secondary: {
    // Mirrors `Input`'s wrapper + inner text: same border/fill/text tokens and
    // the same weight at each size, so a secondary button beside a field reads
    // as one control finish. Height, padding and type size come from the
    // size maps below so each size stays aligned with `Input` at that size.
    container: "rounded-lg border border-control-border bg-control-bg active:bg-surface-muted",
    label: "font-normal text-control-text",
  },
}

/**
 * Label type size per size. Both are closed-scale roles (§2): `md` is Body /
 * Body strong (`text-base leading-6`), `sm` is Title / Meta
 * (`text-sm leading-5`). Applied after `variantStyle.label` via `cn`.
 */
const sizeLabelClassName: Record<ButtonSize, string> = {
  md: "text-base leading-6",
  sm: "text-sm leading-5",
}

/**
 * Horizontal padding per variant per size. `md` is the historical value
 * (`primary px-4`, `secondary px-3`); `sm` steps each down one (`px-3`/`px-2`)
 * for dense rows like the marketplace filters. Applied after
 * `variantStyle.container` via `cn` so tailwind-merge resolves the single
 * `px-*` deterministically.
 */
const sizePaddingClassName: Record<ButtonVariant, Record<ButtonSize, string>> = {
  primary: { md: "px-4", sm: "px-3" },
  secondary: { md: "px-3", sm: "px-2" },
}

/**
 * The variant list, derived from `variantStyle` rather than written out beside
 * it so the two cannot drift. Because `variantStyle` is a `Record` keyed by the
 * whole union, adding a variant to the type *forces* a new entry here, and
 * `Button.variants.test.ts` pins the result to the approved list — so a new look
 * can't reach the app without that proposal landing first.
 */
export const BUTTON_VARIANTS = Object.keys(variantStyle) as ButtonVariant[]

/**
 * The approved densities. `Button.variants.web.test.tsx` pins this to the
 * agreed list, so a new size lands with its proposal the same way a new
 * variant does.
 */
export const BUTTON_SIZES = ["md", "sm"] as const satisfies readonly ButtonSize[]

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
   * Density. `md` is the default everywhere; `sm` is the compact filter
   * density — shorter (`h-8`), smaller label (`text-sm`), tighter padding.
   */
  size?: ButtonSize
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
  size = "md",
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
  // padding and pin the width to the matching square token, so width and
  // height stay equal instead of stretching into a pill.
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
      className={cn(
        BUTTON_BASE_CLASSNAME,
        sizeHeightClassName[size],
        style.container,
        sizePaddingClassName[variant][size],
        iconOnly && (size === "sm" ? "h-8 w-8 px-0" : "w-control px-0"),
        inert && "opacity-50",
        className,
      )}
    >
      {children ?? (
        <ClassNameText className={cn(style.label, sizeLabelClassName[size], labelClassName)}>
          {loading ? "…" : label}
        </ClassNameText>
      )}
    </ClassNamePressable>
  )
}
