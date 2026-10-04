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
  { href, onPress, icon, title, badgeCount },
  ref,
) {
  // "#" is solito's own documented no-op sentinel for a conditionally-absent href.
  const link = useLink({ href: href ?? "#" })
  const navProps = href
    ? { href: link.href, onPress: link.onPress, accessibilityRole: link.accessibilityRole }
    : { onPress, accessibilityRole: "button" as const }

  return (
    <MainNavItem
      ref={ref}
      icon={icon}
      title={title}
      badgeCount={badgeCount}
      navProps={navProps}
      // overflow-hidden lets this shrink below its label's natural width
      // instead of overflowing past min-w-14 — without it, CSS flexbox
      // treats a flex item's min-width as its content's min-content size
      // by default, which stops one item's label from truncating to make
      // room for a sibling once the bar has enough items to overflow at
      // narrow (mobile) widths. Web-only for now: hoisting these into
      // MainNavItem's own classes is a native layout change, so they stay
      // here until it can be checked on a simulator.
      className="shrink overflow-hidden"
    />
  )
})