import type { ComponentType } from "react"
import { Platform, Pressable, type PressableProps, type ViewStyle } from "react-native"
import type { IconProps } from "../../icons/types"

// react-native-web-only `href`, untyped in RN (README).
const LinkPressable = Pressable as ComponentType<PressableProps & { href?: string; className?: string }>

// RN has no "fixed" position (README); native falls back to "absolute".
const fixedToBottomStyle: ViewStyle = {
  position: (Platform.OS === "web" ? "fixed" : "absolute") as ViewStyle["position"],
  bottom: 0,
  left: 0,
  right: 0,
}

export type MainNavProps = {
  href: string
  icon: ComponentType<IconProps>
}

export function MainNav({ href, icon: Icon }: MainNavProps) {
  return (
    <LinkPressable
      accessibilityRole="link"
      href={href}
      style={fixedToBottomStyle}
      className="text-foreground"
    >
      <Icon />
    </LinkPressable>
  )
}
