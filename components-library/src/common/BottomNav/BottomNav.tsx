import type { ComponentType } from "react"
import { Platform, StyleSheet, View, type ViewProps, type ViewStyle } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { MainNav } from "../MainNav/MainNav"
import type { IconProps } from "../../icons/types"

// see Button.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

// "fixed" (below) compiles to nothing on native — see README "Architecture
// boundaries" for why this, not a className, is the real cross-platform fix.
export const nativeOverlayStyle = Platform.OS === "web" ? null : ({ position: "absolute" } as const)

// Clears home-indicator/gesture-bar and mobile-browser chrome even where
// useSafeAreaInsets() reports 0 (the web stub always does) — see README
// "Architecture boundaries".
export const BOTTOM_NAV_MIN_GAP = 12

// Exported so mobile-application's tab bar (which can't render this
// component directly — see README "Architecture boundaries") still matches
// its exact look.
export const BOTTOM_NAV_BAR_CLASSNAME =
  "fixed inset-x-0 bottom-0 z-50 flex-row items-center border-t border-surface-muted bg-surface p-2"

// Shared by this component and mobile-application's tab bar so the
// positioning can't drift between them — see BottomNav.web.test.tsx and
// README "Architecture boundaries".
export function getFloatingNavStyle(insetBottom: number): ViewStyle {
  return StyleSheet.flatten([nativeOverlayStyle, { marginBottom: BOTTOM_NAV_MIN_GAP + insetBottom }])
}

export type BottomNavItem = {
  key: string
  title: string
  icon: ComponentType<IconProps>
  // web wires href, native wires onPress (see MainNav) — a given item
  // normally sets only the one its platform uses.
  href?: string
  onPress?: () => void
  badgeCount?: number
}

export type BottomNavProps = {
  items: BottomNavItem[]
  // Rendered flush right (e.g. a theme toggle) without shifting `items`
  // out of the bar's true center — see the left spacer below.
  trailingItem?: BottomNavItem
}

// The single bottom-nav bar shared by web-application (rendered directly in
// the layout) and mobile-application (rendered as a custom React Navigation
// tabBar) — see README "Architecture boundaries" on component reuse.
export function BottomNav({ items, trailingItem }: BottomNavProps) {
  const insets = useSafeAreaInsets()

  return (
    <ClassNameView className={BOTTOM_NAV_BAR_CLASSNAME} style={getFloatingNavStyle(insets.bottom)}>
      <ClassNameView className="flex-1" />
      <ClassNameView className="flex-row justify-center gap-1">
        {items.map((item) => (
          <MainNav
            key={item.key}
            title={item.title}
            icon={item.icon}
            href={item.href}
            onPress={item.onPress}
            badgeCount={item.badgeCount}
          />
        ))}
      </ClassNameView>
      {/* min-w-14 matches MainNav's own floor: react-native-web's base View
          reset sets min-width: 0 on every flex child regardless of content
          (unlike plain CSS, which would floor this at trailingItem's own
          min-content size by default), so without an explicit min-width
          here this box gets squeezed by flex-1's 50/50 split with the
          empty leading spacer and trailingItem overflows past it — hence
          MainNav.web.tsx's own shrink/overflow-hidden on the item. */}
      <ClassNameView className="min-w-14 flex-1 flex-row justify-end">
        {trailingItem ? (
          <MainNav
            title={trailingItem.title}
            icon={trailingItem.icon}
            href={trailingItem.href}
            onPress={trailingItem.onPress}
            badgeCount={trailingItem.badgeCount}
          />
        ) : null}
      </ClassNameView>
    </ClassNameView>
  )
}
