import type { ComponentType } from "react"
import { Platform, Pressable, Text, type PressableProps, type TextProps } from "react-native"
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

// text-current relies on real CSS inheritance (picks up this Pressable's
// text-muted/active:text-brand color) — works on web, but native has no such
// cascade, so it silently stays at RNW Text's hardcoded black regardless of
// color scheme. text-foreground resolves per theme on native (same fix as
// IconBase for the icon itself), at the cost of not tracking press state
// there the way the web label does.
const labelColorClassName = Platform.OS === "web" ? "text-current" : "text-foreground"

export function MainNav({ href, onPress, icon: Icon, title }: MainNavProps) {
  return (
    <LinkPressable
      accessibilityRole={href ? "link" : "button"}
      href={href}
      onPress={onPress}
      className="min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2 text-muted active:bg-brand/10 active:text-brand"
    >
      <Icon size={22} />
      <ClassNameText className={`text-[11px] font-medium ${labelColorClassName}`} numberOfLines={1}>
        {title}
      </ClassNameText>
    </LinkPressable>
  )
}
