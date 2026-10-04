import { useRef, type ComponentType, type RefAttributes } from "react"
import {
  Pressable,
  TextInput,
  type PressableProps,
  type TextInputProps,
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
const ClassNameTextInput = TextInput as ComponentType<
  TextInputProps & { className?: string } & RefAttributes<TextInput>
>

export type InputProps = TextInputProps & {
  className?: string
  prependIcon?: ComponentType<IconProps>
}

export function Input({ prependIcon: PrependIcon, className, ...rest }: InputProps) {
  const inputRef = useRef<TextInput>(null)

  return (
    // accessible={false}: this Pressable is a mouse/touch convenience for
    // the TextInput it wraps, not a distinct control — screen readers
    // should land on the (labeled) TextInput itself, not stop here too.
    <ClassNamePressable
      testID="input-container"
      accessible={false}
      tabIndex={-1}
      onPress={() => inputRef.current?.focus()}
      style={textCursorStyle}
      className={cn(
        // h-control is the shared control height (tailwind-preset.cjs) — the
        // same token Button uses, so inputs and buttons line up in every form.
        "h-control flex-row items-center gap-2 rounded-lg border border-surface-muted bg-surface px-3",
        className,
      )}
    >
      {PrependIcon ? <PrependIcon size={16} className="text-muted" /> : null}
      <ClassNameTextInput
        ref={inputRef}
        underlineColorAndroid="transparent"
        {...rest}
        className="flex-1 text-sm text-foreground outline-none placeholder:text-muted"
      />
    </ClassNamePressable>
  )
}
