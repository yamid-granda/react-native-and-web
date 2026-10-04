import type { Meta, StoryObj } from "@storybook/react"
import type { ProductData } from "../../types/Product"
import { CartScreen } from "./CartScreen"
import { useCartStore } from "./useCartStore"

const products: ProductData[] = [
  { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 },
  { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 },
]

// The cart persists ids; the products come from the app's api layer. A story has
// none, so the "server" is these two fixtures — which is also what makes the
// story show a *resolved* price rather than whatever a snapshot once held.
const fetchProductsByIds = async (ids: string[]) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

const meta: Meta<typeof CartScreen> = {
  title: "business/CartScreen",
  component: CartScreen,
  args: { fetchProductsByIds },
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
        "1": { id: "1", quantity: 1 },
        "2": { id: "2", quantity: 2 },
      },
    })
  },
}

/** A line the server no longer returns: shown, counted out, and removable. */
export const WithUnavailableItem: Story = {
  play: () => {
    useCartStore.setState({
      items: {
        "1": { id: "1", quantity: 1 },
        "gone": { id: "gone", quantity: 3 },
      },
    })
  },
}
