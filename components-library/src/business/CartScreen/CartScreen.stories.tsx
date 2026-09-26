import type { Meta, StoryObj } from "@storybook/react"
import { CartScreen } from "./CartScreen"
import { useCartStore } from "./useCartStore"

const meta: Meta<typeof CartScreen> = {
  title: "business/CartScreen",
  component: CartScreen,
}

export default meta

type Story = StoryObj<typeof CartScreen>

export const Empty: Story = {
  play: () => {
    useCartStore.setState({ items: {} })
  },
}

export const WithItems: Story = {
  play: () => {
    useCartStore.setState({
      items: {
        "1": { product: { id: "1", title: "Wireless Headphones", price: 129.99 }, quantity: 1 },
        "2": { product: { id: "2", title: "Mechanical Keyboard", price: 89.5 }, quantity: 2 },
      },
    })
  },
}
