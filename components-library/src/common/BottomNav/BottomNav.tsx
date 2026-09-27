import type { ComponentType } from "react"
import { Platform, View, type ViewProps } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { MainNav } from "../MainNav/MainNav"
import type { IconProps } from "../../icons/types"

// see Button.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

// "fixed" (below) compiles to nothing on native — see README "Architecture
// boundaries" for why this, not a className, is the real cross-platform fix.
const nativeOverlayStyle = Platform.OS === "web" ? null : ({ position: "absolute" } as const)

// Clears home-indicator/gesture-bar and mobile-browser chrome even where
// useSafeAreaInsets() reports 0 (the web stub always does) — see README
// "Architecture boundaries".
const MIN_BOTTOM_GAP = 12

export type BottomNavItem = {
  key: string
  title: string
  icon: ComponentType<IconProps>
  // web wires href, native wires onPress (see MainNav) — a given item
  // normally sets only the one its platform uses.
  href?: string
  onPress?: () => void
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
    <ClassNameView
      className="fixed inset-x-0 bottom-0 z-50 flex-row items-center border-t border-surface-muted bg-surface p-2"
      style={[nativeOverlayStyle, { marginBottom: MIN_BOTTOM_GAP + insets.bottom }]}
    >
      <ClassNameView className="flex-1" />
      <ClassNameView className="flex-row justify-center gap-1">
        {items.map((item) => (
          <MainNav
            key={item.key}
            title={item.title}
            icon={item.icon}
            href={item.href}
            onPress={item.onPress}
          />
        ))}
      </ClassNameView>
      <ClassNameView className="flex-1 flex-row justify-end">
        {trailingItem ? (
          <MainNav
            title={trailingItem.title}
            icon={trailingItem.icon}
            href={trailingItem.href}
            onPress={trailingItem.onPress}
          />
        ) : null}
      </ClassNameView>
    </ClassNameView>
  )
}
