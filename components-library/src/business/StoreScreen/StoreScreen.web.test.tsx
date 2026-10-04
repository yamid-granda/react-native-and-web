import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { StoreScreen } from "./StoreScreen"
import type { ProductData } from "../../types/Product"

const products: ProductData[] = [
  {
    id: "prd_1",
    title: "Leather Weekender Bag",
    description: "Full-grain leather.",
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

function renderScreen(props: Partial<React.ComponentProps<typeof StoreScreen>> = {}) {
  const handlers = {
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  render(<StoreScreen storeName="Riverbend Vintage" products={[]} {...handlers} {...props} />)
  return handlers
}

describe("StoreScreen (web, via react-native-web)", () => {
  it("shows the store name and an empty state", () => {
    renderScreen()
    expect(screen.getByText("Riverbend Vintage")).toBeInTheDocument()
    expect(screen.getByText(/You have no products yet/)).toBeInTheDocument()
  })

  it("lists each product with its price and stock", () => {
    renderScreen({ products })
    expect(screen.getByText("Leather Weekender Bag")).toBeInTheDocument()
    // Price and stock share one Text node, so they are asserted together.
    expect(screen.getByText("$189.00 · 6 in stock")).toBeInTheDocument()
    expect(screen.getByText("$32.25 · out of stock")).toBeInTheDocument()
    expect(screen.queryByText(/You have no products yet/)).not.toBeInTheDocument()
  })

  it("shows a loading state", () => {
    renderScreen({ isLoading: true })
    expect(screen.getByText("Loading your products…")).toBeInTheDocument()
  })

  it("shows an error state", () => {
    renderScreen({ error: new Error("Failed to load your products") })
    expect(screen.getByText("Error: Failed to load your products")).toBeInTheDocument()
  })

  it("calls the create, edit and delete callbacks", () => {
    const handlers = renderScreen({ products })

    fireEvent.click(screen.getByText("Add product"))
    expect(handlers.onCreate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByLabelText("Edit Leather Weekender Bag"))
    expect(handlers.onEdit).toHaveBeenCalledWith("prd_1")

    fireEvent.click(screen.getByLabelText("Delete Brass Desk Lamp"))
    expect(handlers.onDelete).toHaveBeenCalledWith("prd_2")
  })

  it("disables the rows and the add button while a write is in flight", () => {
    renderScreen({ products, isMutating: true })
    expect(screen.getByLabelText("Delete Leather Weekender Bag")).toBeDisabled()
    expect(screen.getByRole("button", { name: "Add product" })).toBeDisabled()
  })
})