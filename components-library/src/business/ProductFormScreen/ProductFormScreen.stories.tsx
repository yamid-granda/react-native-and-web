import type { Meta, StoryObj } from "@storybook/react"
import { ProductFormScreen } from "./ProductFormScreen"

const meta: Meta<typeof ProductFormScreen> = {
  title: "business/ProductFormScreen",
  component: ProductFormScreen,
  args: { onSubmit: () => {} },
}

export default meta

type Story = StoryObj<typeof ProductFormScreen>

export const Create: Story = {}

export const Edit: Story = {
  args: {
    product: {
      id: "prd_1",
      title: "Leather Weekender Bag",
      description: "Hand-stitched full-grain leather, brass hardware.",
      price: 189,
      currency: "USD",
      imageUrl: "https://picsum.photos/seed/prod-owned-1/400/400",
      stock: 6,
      storeId: "usr_1",
      storeName: "Riverbend Vintage",
    },
    onCancel: () => {},
  },
}

export const Saving: Story = {
  args: { isSubmitting: true },
}

export const Failed: Story = {
  args: { error: new Error("Title must be at most 200 characters") },
}