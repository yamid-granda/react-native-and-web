import type { Meta, StoryObj } from "@storybook/react"
import type { ComponentType } from "react"
import { View, type ViewProps } from "react-native"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MarketplaceIcon } from "../../icons/MarketplaceIcon/MarketplaceIcon"
import { MainNav } from "./MainNav"

// see MainNav.tsx / README "Architecture boundaries" for why this is cast locally
const ClassNameView = View as ComponentType<ViewProps & { className?: string }>

const meta: Meta<typeof MainNav> = {
  title: "common/MainNav",
  component: MainNav,
}

export default meta

type Story = StoryObj<typeof MainNav>

export const Default: Story = {
  render: () => (
    <ClassNameView className="flex-row gap-1 self-start rounded-2xl bg-surface p-2">
      <MainNav href="/" icon={HomeIcon} title="Home" />
      <MainNav href="/marketplace" icon={MarketplaceIcon} title="Marketplace" />
    </ClassNameView>
  ),
}
