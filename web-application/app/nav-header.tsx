"use client"

import { BottomNav, CartIcon, HomeIcon, MarketplaceIcon } from "@rnw/components-library"

export function NavHeader() {
  return (
    <BottomNav
      items={[
        { key: "home", title: "Home", icon: HomeIcon, href: "/" },
        { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
        { key: "cart", title: "Cart", icon: CartIcon, href: "/cart" },
      ]}
    />
  )
}
