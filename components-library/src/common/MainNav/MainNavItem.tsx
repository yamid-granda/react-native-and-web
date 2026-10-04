import { forwardRef, type ComponentType, type RefAttributes } from "react"
import { Pressable, Text, View, type PressableProps, type TextProps, type ViewProps } from "react-native"
import { cn } from "../../utils/cn"
import type { IconProps } from "../../icons/types"

// see Button.tsx / README "Architecture boundaries" for why these are cast locally.
// `href` is here because the web adapter's navProps carries one and
// react-native-web's View (which Pressable wraps) turns it into a real <a>.
const ClassNamePressable = Pressable as ComponentType<
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

/**
 * Platform-resolved press behaviour. Only this differs between the two
 * `MainNav` adapters, so it is the only thing they compute.
 */
export type MainNavItemNavProps = PressableProps & { href?: string }

export type MainNavItemProps = Omit<MainNavProps, "href" | "onPress"> & {
  navProps: MainNavItemNavProps
  /** Platform-only additions to the item's own layout classes. */
  className?: string
}

const MAIN_NAV_ITEM_CLASSNAME =
  "min-w-14 items-center justify-center gap-1 rounded-xl px-3 py-2 active:bg-brand/10"

/**
 * The nav item both platforms render — the icon, its badge, and the title
 * below it. `MainNav.tsx` and `MainNav.web.tsx` are thin adapters over this:
 * they resolve how a press turns into navigation and nothing else, which is
 * what keeps the native file free of any `solito/navigation` import.
 */
export const MainNavItem = forwardRef<View, MainNavItemProps>(function MainNavItem(
  { navProps, className, icon: Icon, title, badgeCount },
  ref,
) {
  return (
    <ClassNamePressable
      ref={ref}
      {...navProps}
      className={cn(MAIN_NAV_ITEM_CLASSNAME, className)}
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
    </ClassNamePressable>
  )
})