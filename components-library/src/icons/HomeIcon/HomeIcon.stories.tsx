import type { Meta, StoryObj } from "@storybook/react"
import { HomeIcon } from "./HomeIcon"

const meta: Meta<typeof HomeIcon> = {
  title: "icons/HomeIcon",
  component: HomeIcon,
}

export default meta

type Story = StoryObj<typeof HomeIcon>

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
