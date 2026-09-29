import type { Meta, StoryObj } from "@storybook/react"
import { CheckoutScreen } from "./CheckoutScreen"
import { useCartStore } from "../CartScreen/useCartStore"

const meta: Meta<typeof CheckoutScreen> = {
  title: "business/CheckoutScreen",
  component: CheckoutScreen,
}

export default meta

type Story = StoryObj<typeof CheckoutScreen>

export const Empty: Story = {
  play: () => {
    useCartStore.setState({ items: {} })
  },
}

export const WithItems: Story = {
  play: () => {
    useCartStore.setState({
      items: {
        "1": { product: { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 }, quantity: 1 },
        "2": { product: { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 }, quantity: 2 },
      },
    })
  },
}
