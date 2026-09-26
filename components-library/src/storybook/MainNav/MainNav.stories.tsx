import type { Meta, StoryObj } from "@storybook/react"
import { HomeIcon } from "../../icons/HomeIcon/HomeIcon"
import { MainNav } from "./MainNav"

const meta: Meta<typeof MainNav> = {
  title: "storybook/MainNav",
  component: MainNav,
  args: {
    href: "/",
    icon: HomeIcon,
  },
}

export default meta

type Story = StoryObj<typeof MainNav>

export const Default: Story = {}
