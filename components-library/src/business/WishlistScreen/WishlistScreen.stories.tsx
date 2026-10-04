import type { Meta, StoryObj } from "@storybook/react"
import type { ProductData } from "../../types/Product"
import { WishlistScreen } from "./WishlistScreen"
import { useWishlistStore } from "./useWishlistStore"

const products: ProductData[] = [
  { id: "1", title: "Wireless Headphones", price: 129.99, stock: 10 },
  { id: "2", title: "Mechanical Keyboard", price: 89.5, stock: 10 },
]

// See CartScreen.stories.tsx: the wishlist persists ids, the list reads resolved
// products, and a story has no api layer to fetch them with.
const fetchProductsByIds = async (ids: string[]) => ({
  items: products.filter((product) => ids.includes(product.id)),
  missing: ids.filter((id) => !products.some((product) => product.id === id)),
})

const meta: Meta<typeof WishlistScreen> = {
  title: "business/WishlistScreen",
  component: WishlistScreen,
  args: { fetchProductsByIds },
}

export default meta

type Story = StoryObj<typeof WishlistScreen>

export const Empty: Story = {
  play: () => {
    useWishlistStore.setState({ ids: [] })
  },
}

export const WithItems: Story = {
  play: () => {
    useWishlistStore.setState({ ids: ["1", "2"] })
  },
}

/** A saved item the server no longer returns, and nothing else. */
export const WithUnavailableItem: Story = {
  play: () => {
    useWishlistStore.setState({ ids: ["gone", "1"] })
  },
}
