import type { ComponentType } from "react"
import { Pressable, Text, type PressableProps, type TextProps } from "react-native"
import type { IconProps } from "../../icons/types"

// react-native-web-only `href`, untyped in RN (README).
const LinkPressable = Pressable as ComponentType<PressableProps & { href?: string; className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type MainNavProps = {
  href: string
  icon: ComponentType<IconProps>
  title: string
}

export function MainNav({ href, icon: Icon, title }: MainNavProps) {
  return (
    <LinkPressable
      accessibilityRole="link"
      href={href}
      className="min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2 text-muted active:bg-brand/10 active:text-brand"
    >
      <Icon size={22} />
      {/* text-current, not text-muted: RNW's Text hardcodes color (README) */}
      <ClassNameText className="text-[11px] font-medium text-current" numberOfLines={1}>
        {title}
      </ClassNameText>
    </LinkPressable>
  )
}
