import type { ComponentType } from "react"
import { Pressable, type PressableProps } from "react-native"
import type { IconProps } from "../../icons/types"

// react-native-web renders a Pressable with `href` set as a real <a>
// (see View's supportedProps); RN's types don't know about it.
const LinkPressable = Pressable as ComponentType<PressableProps & { href?: string }>

export type MainNavProps = {
  href: string
  icon: ComponentType<IconProps>
}

export function MainNav({ href, icon: Icon }: MainNavProps) {
  return (
    <LinkPressable accessibilityRole="link" href={href}>
      <Icon />
    </LinkPressable>
  )
}
