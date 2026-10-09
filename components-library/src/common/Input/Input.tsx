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

export type InputProps = TextInputProps & {
  /** Styles the wrapping box, not the text field inside it. */
  className?: string
  prependIcon?: ComponentType<IconProps>
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
        "gap-2 rounded-lg border border-control-border bg-control-bg px-3",
        // A one-line input is the shared control height (h-control,
        // tailwind-preset.cjs — the same token Button uses) so inputs and
        // buttons line up. A multiline one has to grow, so it gets padding
        // instead of a fixed height, and starts at the top or the first line
        // would float in the middle of the box.
        multiline ? "items-start py-2" : "h-control flex-row items-center",
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
        // `text-base` (16px) is the default size; `font-normal leading-6` keeps
        // it on the Body role and matches `Button`'s secondary label.
        className={cn(
          "flex-1 text-base font-normal leading-6 text-control-text outline-none placeholder:text-muted",
          multiline && "min-h-20 text-left",
        )}
      />
    </ClassNamePressable>
  )
}