import type { Meta, StoryObj } from "@storybook/react"
import { ProductListScreen } from "./ProductListScreen"

const mockProducts = [
  {
    id: "1",
    title: "Wireless Headphones",
    description: "Noise-cancelling over-ear headphones.",
    price: 129.99,
  },
  {
    id: "2",
    title: "Mechanical Keyboard",
    description: "Hot-swappable 75% keyboard.",
    price: 89.5,
  },
  { id: "3", title: "Ceramic Coffee Mug", price: 18 },
]

const meta: Meta<typeof ProductListScreen> = {
  title: "business/ProductListScreen",
  component: ProductListScreen,
  args: {
    products: mockProducts,
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
