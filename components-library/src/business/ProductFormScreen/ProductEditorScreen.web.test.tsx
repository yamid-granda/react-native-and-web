import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ProductEditorScreen } from "./ProductEditorScreen"
import type { ProductData } from "../../types/Product"

const product: ProductData = {
  id: "prd_1",
  title: "Leather Weekender Bag",
  description: "Full-grain leather.",
  price: 189,
  currency: "USD",
  imageUrl: "https://example.test/bag.png",
  stock: 6,
}

const saveButton = () => screen.getByRole("button", { name: "Save changes" })

/** The props every case needs, so each test states only what it is about. */
function setup(overrides: Partial<Parameters<typeof ProductEditorScreen>[0]> = {}) {
  const props = {
    product,
    update: vi.fn<(id: string, values: { title: string }) => Promise<ProductData>>(),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<ProductEditorScreen {...props} />)
  return props
}

describe("ProductEditorScreen (web, via react-native-web)", () => {
  it("prefills the form from the product being edited", () => {
    setup()

    expect(screen.getByText("Edit product")).toBeInTheDocument()
    expect(screen.getByTestId("product-title")).toHaveValue("Leather Weekender Bag")
    expect(screen.getByTestId("product-price")).toHaveValue("189")
  })

  it("shows a loading line and no form while the product is being fetched", () => {
    const { update } = setup({ product: undefined, isLoading: true })

    expect(screen.getByText("Loading product…")).toBeInTheDocument()
    expect(screen.queryByTestId("product-form-screen")).not.toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it("answers a 404 with 'Product not found.', which is also what 'not yours' answers", () => {
    // No product and no loading means the read failed; the API replies 404 both
    // for a deleted product and for one belonging to another seller, so the two
    // deliberately render the same screen.
    setup({ product: undefined, error: new Error("Not found") })

    expect(screen.getByText("Product not found.")).toBeInTheDocument()
    expect(screen.queryByTestId("product-form-screen")).not.toBeInTheDocument()
  })

  it("updates the product and reports it done only after the update resolves", async () => {
    let release = () => {}
    const update = vi.fn(
      () =>
        new Promise<ProductData>((resolve) => {
          release = () => resolve(product)
        }),
    )
    const { onDone } = setup({ update })

    fireEvent.change(screen.getByTestId("product-price"), { target: { value: "199" } })
    fireEvent.click(saveButton())

    // In flight: the button is inert and nothing has navigated yet.
    await waitFor(() => expect(saveButton()).toBeDisabled())
    expect(update).toHaveBeenCalledWith(
      "prd_1",
      expect.objectContaining({ title: "Leather Weekender Bag", price: 199 }),
    )
    expect(onDone).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })

  it("surfaces a save failure and leaves the form usable", async () => {
    const { onDone } = setup({ update: vi.fn().mockRejectedValue(new Error("Title already used")) })

    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByText("Error: Title already used")).toBeInTheDocument()
    })
    expect(onDone).not.toHaveBeenCalled()
    // Not stuck submitting: the seller can fix the title and try again.
    expect(saveButton()).not.toBeDisabled()
  })

  it("falls back to a generic message when the failure carries none", async () => {
    setup({ update: vi.fn().mockRejectedValue("nope") })

    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByText("Error: Could not save the product")).toBeInTheDocument()
    })
  })

  it("cancels back to the list without saving", () => {
    const { onCancel, update } = setup()

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(onCancel).toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
