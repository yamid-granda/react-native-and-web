import type { Meta, StoryObj } from "@storybook/react"
import { PublicStoreScreen } from "./PublicStoreScreen"
import type { ProductData } from "../../types/Product"

const meta: Meta<typeof PublicStoreScreen> = {
  title: "business/PublicStoreScreen",
  component: PublicStoreScreen,
  args: { storeName: "Riverbend Vintage" },
}

export default meta

type Story = StoryObj<typeof PublicStoreScreen>

const products: ProductData[] = [
  {
    id: "prd_1",
    title: "Leather Weekender Bag",
    description: "Hand-stitched full-grain leather.",
    price: 189,
    currency: "USD",
    imageUrl: "https://picsum.photos/seed/prod-owned-1/400/400",
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

export const WithProducts: Story = {
  args: { products },
}

export const Empty: Story = {
  args: { products: [] },
}

export const Loading: Story = {
  args: { products: [], isLoading: true },
}