import type { Meta, StoryObj } from "@storybook/react"
import { IconsGallery } from "./IconsGallery"

const meta: Meta<typeof IconsGallery> = {
  title: "icons/IconsGallery",
  component: IconsGallery,
}

export default meta

type Story = StoryObj<typeof IconsGallery>

export const Default: Story = {}
