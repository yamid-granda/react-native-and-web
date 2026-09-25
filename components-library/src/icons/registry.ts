import type { ComponentType } from "react"
import { HomeIcon } from "./HomeIcon/HomeIcon"
import { MarketplaceIcon } from "./MarketplaceIcon/MarketplaceIcon"
import type { IconProps } from "./types"

export type IconRegistryEntry = {
  name: string
  Component: ComponentType<IconProps>
  keywords: string[]
}

// Add new icons here (name = the exported component name, matching what
// gets copied from the icons/ searcher story) so they show up there too.
export const iconRegistry: IconRegistryEntry[] = [
  {
    name: "HomeIcon",
    Component: HomeIcon,
    keywords: ["home", "house", "main", "dashboard", "start"],
  },
  {
    name: "MarketplaceIcon",
    Component: MarketplaceIcon,
    keywords: ["marketplace", "shop", "store", "market", "buy", "sell"],
  },
]
