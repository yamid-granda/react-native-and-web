import { forwardRef } from "react"
import type { View } from "react-native"
import { useLink } from "solito/navigation"
import { MainNavItem, type MainNavProps } from "./MainNavItem"

export type { MainNavProps } from "./MainNavItem"

// react-native-web-only `href` (README) — solito/navigation's useLink drives
// it now so a left-click becomes a real Next.js client-side transition
// instead of a full page reload, while still rendering a real <a href> for
// modifier-clicks/middle-clicks/right-click-copy-link to keep working.
export const MainNav = forwardRef<View, MainNavProps>(function MainNav(
  { href, onPress, icon, title, badgeCount, active },
  ref,
) {
  // "#" is solito's own documented no-op sentinel for a conditionally-absent href.
  const link = useLink({ href: href ?? "#" })
  // aria-current marks the section the user is in; a button with no href
  // (Settings, which opens a sheet) has no page to be current on.
  const navProps = href
    ? {
        href: link.href,
        onPress: link.onPress,
        accessibilityRole: link.accessibilityRole,
        "aria-current": active ? ("page" as const) : undefined,
      }
    : { onPress, accessibilityRole: "button" as const }

  return (
    <MainNavItem
      ref={ref}
      icon={icon}
      title={title}
      badgeCount={badgeCount}
      active={active}
      navProps={navProps}
      // Keyboard focus ring is web-only; it stays out of the shared item so
      // native doesn't render it as a stray outline on every tab.
      className="focus-visible:ring-2 focus-visible:ring-brand"
    />
  )
})
