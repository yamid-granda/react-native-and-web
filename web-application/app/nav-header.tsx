"use client"

import {
  BottomNav,
  CartIcon,
  getCartTotalCount,
  HomeIcon,
  MarketplaceIcon,
  MoonIcon,
  SunIcon,
  useCartStore,
} from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

export function NavHeader() {
  const { theme, toggleTheme } = useThemeToggle()
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))

  return (
    <BottomNav
      items={[
        { key: "home", title: "Home", icon: HomeIcon, href: "/" },
        { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
        { key: "cart", title: "Cart", icon: CartIcon, href: "/cart", badgeCount: cartCount },
      ]}
      trailingItem={{
        key: "theme",
        title: "Theme",
        icon: theme === "dark" ? SunIcon : MoonIcon,
        onPress: toggleTheme,
      }}
    />
  )
}
