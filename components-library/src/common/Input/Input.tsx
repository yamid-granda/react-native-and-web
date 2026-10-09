import { useRef, type ComponentType, type RefAttributes } from "react"
import {
  Platform,
  Pressable,
  TextInput,
  type PressableProps,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native"
import { cn } from "../../utils/cn"
import type { IconProps } from "../../icons/types"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally.
// tabIndex isn't in RN's PressableProps (react-native-web-only, same as
// MainNav.web.tsx's href) — needed below to take this wrapper out of tab
// order so it isn't a second, invisible stop before the real TextInput.
const ClassNamePressable = Pressable as ComponentType<
  PressableProps & { className?: string; tabIndex?: number }
>

// Pressable's own default cursor ('pointer', RN's ViewStyle.cursor type only
// allows 'auto' | 'pointer') would otherwise win over any className, since
// it's the second entry in Pressable's internal `style` array — react-native-web
// flattens that array itself before generating CSS, so a passed-in style
// wins deterministically where a competing className's cascade order can't
// be relied on.
const textCursorStyle = { cursor: "text" } as unknown as ViewStyle
// Native centers the glyphs, not the wrapper: `items-center` on the box only
// centers the TextInput view, while Android's default `includeFontPadding` and
// non-zero vertical padding push single-line text toward the top of `h-control`
// (web's <input> centers on its own, which is why only mobile looked off).
// `paddingVertical: 0` leaves height to the wrapper; `textAlignVertical` picks
// the line's position inside the stretched field. Style (not className) so the
// value wins deterministically — same reason as `textCursorStyle` above — and
// no new literal height for `tokens.parity.test.ts` to pin.
// Exported for the web test below: the RNW stylesheet mapping is an
// implementation detail, but the prop contract (zero vertical padding, native
// vertical centering) is what keeps mobile matching web.
export function inputVerticalAlignStyle(multiline?: boolean): TextStyle {
  return {
    paddingVertical: 0,
    textAlignVertical: multiline ? "top" : "center",
  }
}
const ClassNameTextInput = TextInput as ComponentType<
  TextInputProps & { className?: string } & RefAttributes<TextInput>
>

/**
 * Density for tight rows such as the marketplace filters
 * (`improve-proposals/2026-10-09-button-input-sm.md`). Same contract as
 * `Button`'s size: `md` is the `h-control` default, `sm` is the compact
 * filter density (`h-8` height, `text-sm` field).
 */
export type InputSize = "md" | "sm"

/** Approved densities, mirroring `Button`'s `BUTTON_SIZES`. */
export const INPUT_SIZES = ["md", "sm"] as const satisfies readonly InputSize[]

/** Horizontal padding per size; `sm` steps down one for dense filter rows. */
const sizePaddingClassName: Record<InputSize, string> = {
  md: "px-3",
  sm: "px-2",
}

/**
 * Height per size. `md` is the shared control token (tailwind-preset.cjs —
 * the same token `Button` uses) so inputs and buttons line up; `sm` steps
 * down to `h-8` for dense filter rows.
 */
const sizeHeightClassName: Record<InputSize, string> = {
  md: "h-control",
  sm: "h-8",
}

/**
 * Field type size per size. Both are closed-scale roles (§2): `md` is Body
 * (`text-base leading-6`, matching `Button`'s secondary label), `sm` is Meta
 * (`text-sm leading-5`).
 */
const sizeTextClassName: Record<InputSize, string> = {
  md: "text-base leading-6",
  sm: "text-sm leading-5",
}

export type InputProps = Omit<TextInputProps, "size"> & {
  /** Styles the wrapping box, not the text field inside it. */
  className?: string
  prependIcon?: ComponentType<IconProps>
  /**
   * Density. `md` is the default everywhere; `sm` is the compact filter
   * density — shorter (`h-8`), smaller field (`text-sm`), tighter padding
   * (mirrors `Button`'s secondary at each size).
   */
  size?: InputSize
  /**
   * `testID` for the `TextInput` itself.
   *
   * A separate prop because the wrapper already claims `input-container`, and a
   * multi-field form needs a distinct selector per field — `getByTestId` cannot
   * tell three of them apart otherwise.
   */
  inputTestID?: string
}

export function Input({
  prependIcon: PrependIcon,
  className,
  inputTestID,
  multiline,
  size = "md",
  style,
  ...rest
}: InputProps) {
  const inputRef = useRef<TextInput>(null)

  return (
    // accessible={false}: this Pressable is a mouse/touch convenience for
    // the TextInput it wraps, not a distinct control — screen readers should
    // land on the TextInput itself, not stop here too. `Input` does not name
    // that field; `FormField` pairs a caption with an `accessibilityLabel`, so
    // a bare `Input` is a field with no accessible name.
    <ClassNamePressable
      testID="input-container"
      accessible={false}
      tabIndex={-1}
      onPress={() => inputRef.current?.focus()}
      style={textCursorStyle}
      className={cn(
        "gap-2 rounded-lg border border-control-border bg-control-bg",
        sizePaddingClassName[size],
        // A one-line input is the shared control height (h-control,
        // tailwind-preset.cjs — the same token Button uses) so inputs and
        // buttons line up, or h-8 at `sm` for dense filter rows. A multiline
        // one has to grow, so it gets padding instead of a fixed height, and
        // starts at the top or the first line would float in the middle of
        // the box.
        multiline ? "items-start py-2" : cn("flex-row items-center", sizeHeightClassName[size]),
        className,
      )}
    >
      {PrependIcon ? <PrependIcon size={16} className="text-muted" /> : null}
      <ClassNameTextInput
        ref={inputRef}
        underlineColorAndroid="transparent"
        {...rest}
        multiline={multiline}
        testID={inputTestID}
        // `includeFontPadding` is Android-only extra leading that reads as
        // top-shifted text in a fixed-height box. Gated to native: on web
        // react-native-web would forward it to the DOM <input>.
        {...(Platform.OS !== "web" ? { includeFontPadding: false } : null)}
        // Caller `style` first so the vertical-align above wins on conflict
        // while any other caller keys are preserved.
        style={[style, inputVerticalAlignStyle(multiline)] as TextInputProps["style"]}
        // After `{...rest}` and therefore not overridable: a taller box comes from
        // the wrapper's className above, and a textarea aligns to the top.
        // `md` is Body (`text-base` 16px, matching `Button`'s secondary label);
        // `sm` is Meta (`text-sm` 14px).
        className={cn(
          "flex-1 font-normal text-control-text outline-none placeholder:text-muted",
          sizeTextClassName[size],
          multiline && "min-h-20 text-left",
        )}
      />
    </ClassNamePressable>
  )
}