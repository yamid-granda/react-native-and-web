import { forwardRef, type ComponentType, type RefAttributes } from "react"
import { Pressable, Text, View, type PressableProps, type TextProps, type ViewProps } from "react-native"
import { useLink } from "solito/navigation"
import type { IconProps } from "../../icons/types"

// react-native-web-only `href` (README) — solito/navigation's useLink drives
// it now so a left-click becomes a real Next.js client-side transition
// instead of a full page reload, while still rendering a real <a href> for
// modifier-clicks/middle-clicks/right-click-copy-link to keep working.
const LinkPressable = Pressable as ComponentType<
  PressableProps & { href?: string; className?: string } & RefAttributes<View>
>
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>
const ClassNameText = Text as ComponentType<TextProps & { className?: string }>

export type MainNavProps = {
  href?: string
  onPress?: () => void
  icon: ComponentType<IconProps>
  title: string
  badgeCount?: number
}

export const MainNav = forwardRef<View, MainNavProps>(function MainNav(
  { href, onPress, icon: Icon, title, badgeCount },
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
      // overflow-hidden lets this shrink below its label's natural width
      // instead of overflowing past min-w-14 — without it, CSS flexbox
      // treats a flex item's min-width as its content's min-content size
      // by default, which stops one item's label from truncating to make
      // room for a sibling once the bar has enough items to overflow at
      // narrow (mobile) widths.
      className="min-w-14 shrink items-center justify-center gap-1 overflow-hidden rounded-xl px-3 py-2 active:bg-brand/10"
    >
      {({ pressed }) => (
        <>
          <ClassNameView className="relative">
            <Icon size={22} className={pressed ? "text-brand" : "text-muted"} />
            {badgeCount ? (
              <ClassNameView className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1">
                <ClassNameText className="text-xs font-bold text-white" numberOfLines={1}>
                  {badgeCount > 99 ? "99+" : badgeCount}
                </ClassNameText>
              </ClassNameView>
            ) : null}
          </ClassNameView>
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
