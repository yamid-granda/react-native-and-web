import type { Meta, StoryObj } from "@storybook/react"
import { MarketplaceIcon } from "./MarketplaceIcon"

const meta: Meta<typeof MarketplaceIcon> = {
  title: "icons/MarketplaceIcon",
  component: MarketplaceIcon,
}

export default meta

type Story = StoryObj<typeof MarketplaceIcon>

export const Default: Story = {}

export const CustomColor: Story = {
  args: {
    color: "#2563eb",
  },
}

export const Large: Story = {
  args: {
    size: 48,
  },
}
