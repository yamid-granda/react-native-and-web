import type { Meta, StoryObj } from "@storybook/react"
import type { ProductData } from "../../types/Product"
import { CheckoutScreen } from "./CheckoutScreen"
import { useCartStore } from "../CartScreen/useCartStore"

const products: ProductData[] = [
  { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 },
  { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 },
]

// See CartScreen.stories.tsx: the cart persists ids, the order summary reads
// resolved products, and a story has no api layer to fetch them with.
const fetchProductsByIds = async (ids: string[]) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

const meta: Meta<typeof CheckoutScreen> = {
  title: "business/CheckoutScreen",
  component: CheckoutScreen,
  args: { fetchProductsByIds },
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
        "1": { id: "1", quantity: 1 },
        "2": { id: "2", quantity: 2 },
      },
    })
  },
}

/** The dropped-line copy, on the branch that still has something to check out. */
export const WithUnavailableItem: Story = {
  play: () => {
    useCartStore.setState({
      items: {
        "1": { id: "1", quantity: 1 },
        "gone": { id: "gone", quantity: 2 },
      },
    })
  },
}
