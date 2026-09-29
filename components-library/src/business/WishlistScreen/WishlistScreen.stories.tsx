import type { Meta, StoryObj } from "@storybook/react"
import { WishlistScreen } from "./WishlistScreen"
import { useWishlistStore } from "./useWishlistStore"

const meta: Meta<typeof WishlistScreen> = {
  title: "business/WishlistScreen",
  component: WishlistScreen,
}

export default meta

type Story = StoryObj<typeof WishlistScreen>

export const Empty: Story = {
  play: () => {
    useWishlistStore.setState({ items: {} })
  },
}

export const WithItems: Story = {
  play: () => {
    useWishlistStore.setState({
      items: {
        "1": { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 },
        "2": { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 },
      },
    })
  },
}
