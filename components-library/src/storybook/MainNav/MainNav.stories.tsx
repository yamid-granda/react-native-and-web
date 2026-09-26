import type { Meta, StoryObj } from "@storybook/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { MainNav } from "./MainNav"

const meta: Meta<typeof MainNav> = {
  title: "storybook/MainNav",
  component: MainNav,
}

export default meta

type Story = StoryObj<typeof MainNav>

export const Home: Story = {
  args: {
    href: "/",
    icon: HomeIcon,
  },
}

export const Marketplace: Story = {
  args: {
    href: "/marketplace",
    icon: MarketplaceIcon,
  },
}
