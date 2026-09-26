import type { Meta, StoryObj } from "@storybook/react"
import { ProductDetailScreen } from "./ProductDetailScreen"

const mockProduct = {
  id: "1",
  title: "Wireless Headphones",
  description: "Noise-cancelling over-ear headphones with 30h battery life.",
  price: 129.99,
  imageUrl: "https://picsum.photos/seed/headphones/400/400",
}

const meta: Meta<typeof ProductDetailScreen> = {
  title: "business/ProductDetailScreen",
  component: ProductDetailScreen,
  args: {
    product: mockProduct,
  },
}

export default meta

type Story = StoryObj<typeof ProductDetailScreen>

export const Default: Story = {}

export const Loading: Story = {
  args: {
    product: null,
    isLoading: true,
  },
}

export const ErrorState: Story = {
  args: {
    product: null,
    error: new Error("Failed to load product"),
  },
}

export const NotFound: Story = {
  args: {
    product: null,
  },
}
