"use client"

import {
  BottomNav,
  CartIcon,
  getCartTotalCount,
  getWishlistTotalCount,
  HeartIcon,
  HomeIcon,
  MarketplaceIcon,
  MoonIcon,
  SunIcon,
  useCartStore,
  useWishlistStore,
} from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

export function NavHeader() {
  const { theme, toggleTheme } = useThemeToggle()
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))
  const wishlistCount = useWishlistStore((state) => getWishlistTotalCount(state.items))

  return (
    <BottomNav
      items={[
        { key: "home", title: "Home", icon: HomeIcon, href: "/" },
        { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
        {
          key: "wishlist",
          title: "Wishlist",
          icon: HeartIcon,
          href: "/wishlist",
          badgeCount: wishlistCount,
        },
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
