import type { ComponentType } from "react"
import { Pressable, Text, type PressableProps, type TextProps } from "react-native"
import type { IconProps } from "../../icons/types"

// react-native-web-only `href`, untyped in RN (README).
const LinkPressable = Pressable as ComponentType<
  PressableProps & { href?: string; className?: string }
>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type MainNavProps = {
  // href drives real navigation on web (react-native-web renders it as an
  // <a>); native has no such mechanism, so it navigates via onPress instead.
  href?: string
  onPress?: () => void
  icon: ComponentType<IconProps>
  title: string
}

export function MainNav({ href, onPress, icon: Icon, title }: MainNavProps) {
  return (
    <LinkPressable
      accessibilityRole={href ? "link" : "button"}
      href={href}
      onPress={onPress}
      className="min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2 active:bg-brand/10"
    >
      {/* Pressable's render-prop `pressed` state (core RN API, works
          identically on web and native) drives the color directly, instead
          of a CSS-only trick like currentColor/group-active that react-
          native-svg and this NativeWind version can't resolve on native. */}
      {({ pressed }) => (
        <>
          <Icon size={22} className={pressed ? "text-brand" : "text-muted"} />
          <ClassNameText
            className={`text-sm font-medium ${pressed ? "text-brand" : "text-muted"}`}
            numberOfLines={1}
          >
            {title}
          </ClassNameText>
        </>
      )}
    </LinkPressable>
  )
}
