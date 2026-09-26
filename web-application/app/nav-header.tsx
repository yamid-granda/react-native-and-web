"use client"

import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import { CartIcon, HomeIcon, MainNav, MarketplaceIcon } from "@rnw/components-library"

// see components-library's Button.tsx / README "Architecture boundaries"
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

export function NavHeader() {
  return (
    <ClassNameView className="flex-row gap-1 self-start rounded-2xl bg-surface p-2">
      <MainNav href="/" icon={HomeIcon} title="Home" />
      <MainNav href="/marketplace" icon={MarketplaceIcon} title="Marketplace" />
      <MainNav href="/cart" icon={CartIcon} title="Cart" />
    </ClassNameView>
  )
}
