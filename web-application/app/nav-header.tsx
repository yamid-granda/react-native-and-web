"use client"

import { BottomNav, CartIcon, HomeIcon, MarketplaceIcon, MoonIcon, SunIcon } from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

export function NavHeader() {
  const { theme, toggleTheme } = useThemeToggle()

  return (
    <BottomNav
      items={[
        { key: "home", title: "Home", icon: HomeIcon, href: "/" },
        { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
        { key: "cart", title: "Cart", icon: CartIcon, href: "/cart" },
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
