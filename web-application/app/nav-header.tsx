"use client"

import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
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
  useT,
  useWishlistStore,
} from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

// see Button.tsx (components-library) / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export function NavHeader() {
  const { theme, toggleTheme } = useThemeToggle()
  const t = useT()
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))
  const wishlistCount = useWishlistStore((state) => getWishlistTotalCount(state.ids))

  // Phone/tablet only: desktop uses DesktopHeader (`hidden lg:flex`).
  return (
    <ClassNameView testID="bottom-nav-mobile" className="lg:hidden">
      <BottomNav
      items={[
        { key: "home", title: t("navHome"), icon: HomeIcon, href: "/" },
        { key: "my-store", title: t("homeMyStore"), icon: MarketplaceIcon, href: "/my-store" },
        {
          key: "wishlist",
          title: t("navWishlist"),
          icon: HeartIcon,
          href: "/wishlist",
          badgeCount: wishlistCount,
        },
        { key: "cart", title: t("navCart"), icon: CartIcon, href: "/cart", badgeCount: cartCount },
      ]}
      trailingItem={{
        key: "theme",
        title: t("navTheme"),
        icon: theme === "dark" ? SunIcon : MoonIcon,
        onPress: toggleTheme,
      }}
      />
    </ClassNameView>
  )
}
