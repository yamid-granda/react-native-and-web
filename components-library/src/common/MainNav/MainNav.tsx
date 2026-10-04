import { forwardRef } from "react"
import type { View } from "react-native"
import { MainNavItem, type MainNavProps } from "./MainNavItem"

export type { MainNavProps } from "./MainNavItem"

// Native: navigation happens entirely via onPress (there's no RN concept of
// href) — a Tabs.Screen link injects it via expo-router/ui's TabTrigger
// asChild, the same mechanism the Theme toggle's plain onPress already
// relies on. See MainNav.web.tsx for the web implementation.
export const MainNav = forwardRef<View, MainNavProps>(function MainNav(
  { onPress, icon, title, badgeCount },
  ref,
) {
  return (
    <MainNavItem
      ref={ref}
      icon={icon}
      title={title}
      badgeCount={badgeCount}
      navProps={{ accessibilityRole: "button", onPress }}
    />
  )
})