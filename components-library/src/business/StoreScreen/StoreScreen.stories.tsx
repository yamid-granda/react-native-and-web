import type { Meta, StoryObj } from "@storybook/react"
import { StoreScreen } from "./StoreScreen"
import type { ProductData } from "../../types/Product"

const meta: Meta<typeof StoreScreen> = {
  title: "business/StoreScreen",
  component: StoreScreen,
  args: {
    storeName: "Riverbend Vintage",
    onCreate: () => {},
    onEdit: () => {},
    onDelete: () => {},
  },
}

export default meta

type Story = StoryObj<typeof StoreScreen>

const products: ProductData[] = [
  {
    id: "prd_1",
    title: "Leather Weekender Bag",
    description: "Hand-stitched full-grain leather.",
    price: 189,
    currency: "USD",
    stock: 6,
    storeId: "usr_1",
    storeName: "Riverbend Vintage",
  },
  {
    id: "prd_2",
    title: "Brass Desk Lamp",
    price: 32.25,
    currency: "USD",
    stock: 0,
    storeId: "usr_1",
    storeName: "Riverbend Vintage",
  },
]

export const Empty: Story = {
  args: { products: [] },
}

export const WithProducts: Story = {
  args: { products },
}

export const Loading: Story = {
  args: { products: [], isLoading: true },
}

// Not named `Error`: a story export shadows the global inside this module.
export const Failed: Story = {
  args: { products: [], error: new Error("Failed to load your products") },
}

export const Saving: Story = {
  args: { products, isMutating: true },
}