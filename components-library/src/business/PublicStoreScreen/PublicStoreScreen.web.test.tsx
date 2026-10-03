import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { PublicStoreScreen } from "./PublicStoreScreen"
import type { ProductData } from "../../types/Product"

const products: ProductData[] = [
  {
    id: "prd_1",
    title: "Leather Weekender Bag",
    price: 189,
    currency: "USD",
    stock: 6,
    storeId: "usr_1",
    storeName: "Riverbend Vintage",
  },
]

describe("PublicStoreScreen (web, via react-native-web)", () => {
  it("shows the store name and its products", () => {
    render(<PublicStoreScreen storeName="Riverbend Vintage" products={products} />)
    expect(screen.getByText("Riverbend Vintage")).toBeInTheDocument()
    // Reuses common/Product, so the card and its price come along for free.
    expect(screen.getByText("Leather Weekender Bag")).toBeInTheDocument()
    expect(screen.getByText("$189.00")).toBeInTheDocument()
  })

  it("shows an empty state", () => {
    render(<PublicStoreScreen storeName="Riverbend Vintage" products={[]} />)
    expect(screen.getByText("This store has no products yet.")).toBeInTheDocument()
  })

  it("shows loading and error states", () => {
    const { unmount } = render(
      <PublicStoreScreen storeName="Riverbend Vintage" products={[]} isLoading />,
    )
    expect(screen.getByText("Loading products…")).toBeInTheDocument()
    unmount()

    render(
      <PublicStoreScreen
        storeName="Riverbend Vintage"
        products={[]}
        error={new Error("Store not found")}
      />,
    )
    expect(screen.getByText("Error: Store not found")).toBeInTheDocument()
  })

  it("selects a product", () => {
    const onSelectProduct = vi.fn()
    render(
      <PublicStoreScreen
        storeName="Riverbend Vintage"
        products={products}
        onSelectProduct={onSelectProduct}
      />,
    )
    fireEvent.click(screen.getByTestId("product-card-prd_1"))
    expect(onSelectProduct).toHaveBeenCalledWith("prd_1")
  })
})