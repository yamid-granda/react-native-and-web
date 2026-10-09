"use client"

import { useState, type ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import { usePathname } from "next/navigation"
import {
  CartIcon,
  HeartIcon,
  HomeIcon,
  MainNav,
  MarketplaceIcon,
  SettingsIcon,
  SettingsSheet,
  getCartTotalCount,
  getWishlistTotalCount,
  isNavPathActive,
  useCartStore,
  useLocale,
  useT,
  useWishlistStore,
  type BottomNavItem as DesktopNavItem,
} from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

// see Button.tsx (components-library) / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

// Desktop-only top header. Web app only: never imported by mobile-application.
// Phone/tablet keep BottomNav (see nav-header.tsx `lg:hidden`); this bar is
// `hidden lg:flex` so exactly one nav is visible per viewport.
export function DesktopHeader() {
  const { theme, setTheme } = useThemeToggle()
  const t = useT()
  const { locale, setLocale } = useLocale()
  const [settingsVisible, setSettingsVisible] = useState(false)
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))
  const wishlistCount = useWishlistStore((state) => getWishlistTotalCount(state.ids))
  const pathname = usePathname() ?? ""
  const isActive = (href: string) => isNavPathActive(pathname, href)

  const items: DesktopNavItem[] = [
    { key: "home", title: t("navHome"), icon: HomeIcon, href: "/", active: isActive("/") },
    {
      key: "my-store",
      title: t("homeMyStore"),
      icon: MarketplaceIcon,
      href: "/my-store",
      active: isActive("/my-store"),
    },
    {
      key: "wishlist",
      title: t("navWishlist"),
      icon: HeartIcon,
      href: "/wishlist",
      badgeCount: wishlistCount,
      active: isActive("/wishlist"),
    },
    {
      key: "cart",
      title: t("navCart"),
      icon: CartIcon,
      href: "/cart",
      badgeCount: cartCount,
      active: isActive("/cart"),
    },
  ]

  return (
    <ClassNameView
      testID="desktop-header"
      className="sticky top-0 z-40 hidden border-b border-surface-muted bg-surface lg:flex"
    >
      <ClassNameView className="mx-auto w-full max-w-3xl flex-row items-center justify-between gap-4 px-8 lg:max-w-6xl xl:max-w-7xl">
        <ClassNameView className="flex-row items-center">
          {items.map((item) => (
            <MainNav
              key={item.key}
              title={item.title}
              icon={item.icon}
              href={item.href}
              onPress={item.onPress}
              badgeCount={item.badgeCount}
              active={item.active}
            />
          ))}
        </ClassNameView>
        <MainNav
          title={t("navSettings")}
          icon={SettingsIcon}
          onPress={() => setSettingsVisible(true)}
          active={settingsVisible}
        />
      </ClassNameView>
      <SettingsSheet
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        theme={theme}
        onThemeChange={setTheme}
        locale={locale}
        onLocaleChange={setLocale}
      />
    </ClassNameView>
  )
}
