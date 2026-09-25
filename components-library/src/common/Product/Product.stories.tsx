import type { Meta, StoryObj } from "@storybook/react"
import { Product } from "./Product"

const meta: Meta<typeof Product> = {
  title: "common/Product",
  component: Product,
  args: {
    id: "1",
    title: "Wireless Headphones",
    description: "Noise-cancelling over-ear headphones with 30h battery life.",
    price: 129.99,
  },
}

export default meta

type Story = StoryObj<typeof Product>

export const Default: Story = {}

export const WithImage: Story = {
  args: {
    imageUrl: "https://picsum.photos/seed/headphones/400/400",
  },
}

export const WithoutDescription: Story = {
  args: {
    description: undefined,
  },
}
