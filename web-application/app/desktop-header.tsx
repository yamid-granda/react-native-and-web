"use client"

import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import {
  CartIcon,
  HeartIcon,
  HomeIcon,
  MainNav,
  MarketplaceIcon,
  MoonIcon,
  SunIcon,
  getCartTotalCount,
  getWishlistTotalCount,
  useCartStore,
  useT,
  useWishlistStore,
  type IconProps,
} from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

// see Button.tsx (components-library) / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

type DesktopNavItem = {
  key: string
  title: string
  icon: ComponentType<IconProps>
  href?: string
  onPress?: () => void
  badgeCount?: number
}

// Desktop-only top header. Web app only: never imported by mobile-application.
// Phone/tablet keep BottomNav (see nav-header.tsx `lg:hidden`); this bar is
// `hidden lg:flex` so exactly one nav is visible per viewport.
export function DesktopHeader() {
  const { theme, toggleTheme } = useThemeToggle()
  const t = useT()
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))
  const wishlistCount = useWishlistStore((state) => getWishlistTotalCount(state.ids))

  const items: DesktopNavItem[] = [
    { key: "home", title: t("navHome"), icon: HomeIcon, href: "/" },
    { key: "marketplace", title: t("navMarketplace"), icon: MarketplaceIcon, href: "/marketplace" },
    {
      key: "wishlist",
      title: t("navWishlist"),
      icon: HeartIcon,
      href: "/wishlist",
      badgeCount: wishlistCount,
    },
    { key: "cart", title: t("navCart"), icon: CartIcon, href: "/cart", badgeCount: cartCount },
  ]

  return (
    <ClassNameView
      testID="desktop-header"
      className="sticky top-0 z-40 hidden border-b border-surface-muted bg-surface lg:flex"
    >
      <ClassNameView className="mx-auto w-full max-w-3xl flex-row items-center justify-between gap-4 px-8 py-2 lg:max-w-6xl xl:max-w-7xl">
        <ClassNameView className="flex-row items-center gap-1">
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
        <MainNav
          title={t("navTheme")}
          icon={theme === "dark" ? SunIcon : MoonIcon}
          onPress={toggleTheme}
        />
      </ClassNameView>
    </ClassNameView>
  )
}
