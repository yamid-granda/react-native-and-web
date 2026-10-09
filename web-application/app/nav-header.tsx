"use client"

import { useState, type ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import {
  BottomNav,
  CartIcon,
  getCartTotalCount,
  getWishlistTotalCount,
  HeartIcon,
  HomeIcon,
  MarketplaceIcon,
  SettingsIcon,
  SettingsSheet,
  useCartStore,
  useLocale,
  useT,
  useWishlistStore,
} from "@rnw/components-library"
import { useThemeToggle } from "./use-theme-toggle"

// see Button.tsx (components-library) / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export function NavHeader() {
  const { theme, setTheme } = useThemeToggle()
  const t = useT()
  const { locale, setLocale } = useLocale()
  const [settingsVisible, setSettingsVisible] = useState(false)
  const cartCount = useCartStore((state) => getCartTotalCount(state.items))
  const wishlistCount = useWishlistStore((state) => getWishlistTotalCount(state.ids))

  // Phone/tablet only: desktop uses DesktopHeader (`hidden lg:flex`).
  // Mobile order: settings flush left, the rest flush right in reverse
  // (left-to-right: cart, wishlist, my-store, home).
  return (
    <ClassNameView testID="bottom-nav-mobile" className="lg:hidden">
      <BottomNav
        leadingItem={{
          key: "settings",
          title: t("navSettings"),
          icon: SettingsIcon,
          onPress: () => setSettingsVisible(true),
        }}
        items={[
          { key: "cart", title: t("navCart"), icon: CartIcon, href: "/cart", badgeCount: cartCount },
          {
            key: "wishlist",
            title: t("navWishlist"),
            icon: HeartIcon,
            href: "/wishlist",
            badgeCount: wishlistCount,
          },
          { key: "my-store", title: t("homeMyStore"), icon: MarketplaceIcon, href: "/my-store" },
          { key: "home", title: t("navHome"), icon: HomeIcon, href: "/" },
        ]}
      />
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
