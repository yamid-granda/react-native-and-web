import type { ComponentType } from "react"
import { Pressable, Text, type PressableProps, type TextProps } from "react-native"
import { cn } from "../../utils/cn"

// nativewind's className typing doesn't cover PressableProps and doesn't
// merge reliably across workspace packages (README), so cast locally.
const ClassNamePressable = Pressable as ComponentType<PressableProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type ButtonProps = {
  label: string
  onPress?: () => void
  className?: string
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
}

export function Button({ label, onPress, className, disabled, loading }: ButtonProps) {
  const inert = Boolean(disabled || loading)

  return (
    <ClassNamePressable
      accessibilityRole="button"
      // The visible label becomes "…" while loading, which would leave a screen
      // reader with nothing to announce — so the name is carried explicitly and
      // the busy state is announced alongside it.
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert }}
      // `aria-busy` rather than `accessibilityState.busy`: react-native-web only
      // reads the aria-* spelling, and RN 0.71+ accepts it natively too. Verified
      // in react-native-web's createDOMProps — `accessibilityState.busy` is
      // dropped on web, so using it here would announce nothing.
      aria-busy={Boolean(loading)}
      disabled={inert}
      onPress={onPress}
      className={cn(
        "items-center justify-center rounded-lg bg-brand px-4 py-3 active:bg-brand-dark",
        inert && "opacity-50",
        className,
      )}
    >
      <ClassNameText className="text-base font-semibold text-white">
        {loading ? "…" : label}
      </ClassNameText>
    </ClassNamePressable>
  )
}