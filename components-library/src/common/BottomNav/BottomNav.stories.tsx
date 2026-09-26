import type { Meta, StoryObj } from "@storybook/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { CartIcon } from "../../icons/CartIcon/CartIcon"
import { BottomNav } from "./BottomNav"

const meta: Meta<typeof BottomNav> = {
  title: "common/BottomNav",
  component: BottomNav,
  args: {
    items: [
      { key: "home", title: "Home", icon: HomeIcon, href: "/" },
      { key: "marketplace", title: "Marketplace", icon: MarketplaceIcon, href: "/marketplace" },
      { key: "cart", title: "Cart", icon: CartIcon, href: "/cart" },
    ],
  },
}

export default meta

type Story = StoryObj<typeof BottomNav>

export const Default: Story = {}
