import type { ComponentType, ReactNode } from "react"
import { Pressable, Text, type PressableProps, type TextProps } from "react-native"
import { cn } from "../../utils/cn"
import { toButtonTestId } from "./buttonTestId"

// nativewind's className typing doesn't cover PressableProps and doesn't
// merge reliably across workspace packages (README), so cast locally.
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

/** The only button looks in the repo. Every app button must pick one. */
export type ButtonVariant =
  /** Filled brand. The one primary call-to-action per view. */
  | "primary"
  /** Filled neutral surface. Secondary actions and icon buttons. */
  | "secondary"
  /** Bordered, surface-filled. */
  | "outline"
  /** No fill, brand label. Link-style actions (Remove, Go to Cart). */
  | "ghost"
  /** Pill toggle for filters; reads `selected` for its own colors. */
  | "chip"

/** `sm`/`md` only change padding and label size — never height. */
export type ButtonSize = "sm" | "md" | "icon"

// Height comes from the shared `h-control` token (tailwind-preset.cjs) and is
// deliberately the only height any button may use, so buttons and inputs line
// up everywhere. Sizes below contribute padding/label size only.
const BUTTON_BASE_CLASSNAME = "h-control items-center justify-center"

const sizeClassNames: Record<ButtonSize, string> = {
  sm: "px-3",
  md: "px-4",
  icon: "w-control rounded-full px-0",
}

const labelSizeClassNames: Record<Exclude<ButtonSize, "icon">, string> = {
  sm: "text-sm font-semibold",
  md: "text-base font-semibold",
}

type ButtonStyle = { container: string; label: string }

const variantStyle: Record<ButtonVariant, ButtonStyle> = {
  primary: {
    container: "rounded-lg bg-brand active:bg-brand-dark",
    label: "text-white",
  },
  secondary: {
    container: "rounded-lg bg-surface active:bg-surface-muted",
    label: "text-foreground",
  },
  outline: {
    container: "rounded-lg border border-surface-muted bg-surface active:bg-surface-muted",
    label: "text-foreground",
  },
  ghost: {
    container: "rounded-lg active:bg-brand/10",
    label: "text-brand",
  },
  // The two states are the whole point of a chip, so they can't be merged into
  // one className pair the way the static variants are.
  chip: { container: "rounded-full border", label: "" },
}

const chipSelectedStyle: ButtonStyle = {
  container: "border-brand bg-brand/10",
  label: "text-brand",
}

const chipUnselectedStyle: ButtonStyle = {
  container: "border-surface-muted bg-surface",
  label: "text-muted",
}

export type ButtonProps = {
  /**
   * The button's visible text, its accessible name, and — unless `testID` is
   * given — the source of its `testID`. Required even for icon buttons so every
   * button in the app is addressable by a predictable test id.
   */
  label: string
  /**
   * Replaces the label's text node, for icon-only buttons. Not wrapped in a
   * `Text` here on purpose: callers pass native-safe children themselves (an
   * icon, or a `<Text>` around a "+"/"-" glyph). Without them the label is
   * rendered as normal, so a forgotten `size="icon"` shows the text rather than
   * producing an invisible control.
   */
  children?: ReactNode
  onPress?: () => void
  variant?: ButtonVariant
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
  /** Only meaningful for `variant="chip"`; also drives `aria-selected`. */
  selected?: boolean
  /** Overrides `label` as the accessible name when the visible text is a poor one. */
  accessibilityLabel?: string
  /** Overrides the label-derived `testID`; use to keep list-row buttons unique. */
  testID?: string
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
  testID,
  className,
  labelClassName,
}: ButtonProps) {
  const inert = Boolean(disabled || loading)
  const style =
    variant === "chip"
      ? selected
        ? chipSelectedStyle
        : chipUnselectedStyle
      : variantStyle[variant]
  // An icon button gets its content from `children`, so it has no label to size.
  const labelSize = size === "icon" ? undefined : labelSizeClassNames[size]

  return (
    <ClassNamePressable
      // Derived from `label` rather than from the rendered text, so a button
      // keeps the same test id while `loading` swaps the label for "…".
      testID={testID ?? toButtonTestId(label)}
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
      // accessibilityState spelling of it too.
      aria-selected={variant === "chip" ? Boolean(selected) : undefined}
      disabled={inert}
      onPress={onPress}
      className={cn(
        BUTTON_BASE_CLASSNAME,
        style.container,
        sizeClassNames[size],
        inert && "opacity-50",
        className,
      )}
    >
      {children ?? (
        <ClassNameText className={cn(style.label, labelSize, labelClassName)}>
          {loading ? "…" : label}
        </ClassNameText>
      )}
    </ClassNamePressable>
  )
}