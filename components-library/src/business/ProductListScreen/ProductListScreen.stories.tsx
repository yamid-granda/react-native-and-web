import type { Meta, StoryObj } from "@storybook/react"
import { ProductListScreen } from "./ProductListScreen"

const mockProducts = [
  {
    id: "1",
    title: "Wireless Headphones",
    description: "Noise-cancelling over-ear headphones.",
    price: 129.99,
    stock: 10,
  },
  {
    id: "2",
    title: "Mechanical Keyboard",
    description: "Hot-swappable 75% keyboard.",
    price: 89.5,
    stock: 0,
  },
  { id: "3", title: "Ceramic Coffee Mug", price: 18, stock: 3 },
]

const meta: Meta<typeof ProductListScreen> = {
  title: "business/ProductListScreen",
  component: ProductListScreen,
  args: {
    products: mockProducts,
    // Only the recently-viewed rail needs it, and it resolves the ids the rail
    // store holds. A story has no api layer, so this resolves the same fixtures
    // the grid is given — enough for a "with a rail" story to have a rail.
    fetchProductsByIds: async (ids: string[]) => ({
      items: mockProducts.filter((product) => ids.includes(product.id)),
      missing: ids.filter((id) => !mockProducts.some((product) => product.id === id)),
    }),
  },
}

export default meta

type Story = StoryObj<typeof ProductListScreen>

export const Default: Story = {}

export const Loading: Story = {
  args: {
    products: [],
    isLoading: true,
  },
}

export const ErrorState: Story = {
  args: {
    products: [],
    error: new Error("Failed to load products"),
  },
}

export const Empty: Story = {
  args: {
    products: [],
  },
}
