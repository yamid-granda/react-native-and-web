import type { Meta, StoryObj } from "@storybook/react"
import { IconGallery } from "./IconGallery"

const meta: Meta<typeof IconGallery> = {
  title: "icons/Icon searcher",
  component: IconGallery,
}

export default meta

type Story = StoryObj<typeof IconGallery>

export const Default: Story = {}
