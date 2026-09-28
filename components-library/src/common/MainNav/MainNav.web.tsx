import { forwardRef, type ComponentType, type RefAttributes } from "react"
import { Pressable, Text, type View, type PressableProps, type TextProps } from "react-native"
import { useLink } from "solito/navigation"
import type { IconProps } from "../../icons/types"

// react-native-web-only `href` (README) — solito/navigation's useLink drives
// it now so a left-click becomes a real Next.js client-side transition
// instead of a full page reload, while still rendering a real <a href> for
// modifier-clicks/middle-clicks/right-click-copy-link to keep working.
const LinkPressable = Pressable as ComponentType<
  PressableProps & { href?: string; className?: string } & RefAttributes<View>
>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type MainNavProps = {
  href?: string
  onPress?: () => void
  icon: ComponentType<IconProps>
  title: string
}

export const MainNav = forwardRef<View, MainNavProps>(function MainNav(
  { href, onPress, icon: Icon, title },
  ref,
) {
  // "#" is solito's own documented no-op sentinel for a conditionally-absent href.
  const link = useLink({ href: href ?? "#" })
  const navProps = href
    ? { href: link.href, onPress: link.onPress, accessibilityRole: link.accessibilityRole }
    : { onPress, accessibilityRole: "button" as const }

  return (
    <LinkPressable
      ref={ref}
      {...navProps}
      className="min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2 active:bg-brand/10"
    >
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
})
