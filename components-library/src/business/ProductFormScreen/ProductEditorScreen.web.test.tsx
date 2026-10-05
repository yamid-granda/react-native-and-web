import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ProductEditorScreen, type ProductEditorScreenProps } from "./ProductEditorScreen"
import type { ProductData } from "../../types/Product"

const product: ProductData = {
  id: "prd_1",
  title: "Leather Weekender Bag",
  description: "Full-grain leather.",
  price: 189,
  currency: "USD",
  stock: 6,
  storeId: "usr_1",
  storeName: "Riverbend Vintage",
}

const saveButton = () => screen.getByRole("button", { name: "Save changes" })

/**
 * Renders the screen the way a route does: the submitting flag and the save error
 * are the route's `useState` pair, which is what makes this reachable without a
 * router on either platform.
 */
function renderEditor(props: Partial<ProductEditorScreenProps> = {}) {
  // What was actually rendered, so a test can assert on the handler it overrode
  // rather than on the default that was replaced.
  const handlers = {
    update: vi.fn().mockResolvedValue(product),
    onDone: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  }

  function Route() {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    return (
      <ProductEditorScreen
        product={product}
        isLoading={false}
        error={error}
        isSubmitting={isSubmitting}
        setSubmitting={setIsSubmitting}
        setError={setError}
        update={handlers.update}
        onDone={handlers.onDone}
        onCancel={handlers.onCancel}
        {...props}
      />
    )
  }

  render(<Route />)
  return handlers
}

/** An `update` that stays in flight until the returned `release` is called. */
function deferredUpdate() {
  let release = () => {}
  const update = vi.fn(
    () =>
      new Promise<ProductData>((resolve) => {
        release = () => resolve(product)
      })
  )
  return { update, release: () => release() }
}

describe("ProductEditorScreen (web, via react-native-web)", () => {
  it("shows a loading line while the product is being read", () => {
    renderEditor({ isLoading: true })
    expect(screen.getByText("Loading product…")).toBeInTheDocument()
    expect(screen.queryByText("Product not found.")).not.toBeInTheDocument()
  })

  it("explains a product that could not be read, which is also how 'not yours' answers", () => {
    renderEditor({ product: undefined })
    expect(screen.getByText("Product not found.")).toBeInTheDocument()
    expect(screen.queryByTestId("product-form-screen")).not.toBeInTheDocument()
  })

  it("prefills the form from the product being edited", () => {
    renderEditor()
    expect(screen.getByText("Edit product")).toBeInTheDocument()
    expect(screen.getByTestId("product-title")).toHaveValue("Leather Weekender Bag")
    expect(screen.getByTestId("product-price")).toHaveValue("189")
  })

  it("saves through the injected update, and only reports done once it resolves", async () => {
    const deferred = deferredUpdate()
    const { update, onDone } = renderEditor({ update: deferred.update })

    fireEvent.click(saveButton())

    expect(update).toHaveBeenCalledWith("prd_1", {
      title: "Leather Weekender Bag",
      description: "Full-grain leather.",
      price: 189,
      // The product has no image, and the form still sends the key: `""` is how
      // the server is told to clear a column rather than leave it alone.
      imageUrl: "",
      stock: 6,
    })
    // Still in flight: the screen must not report success before the server has.
    expect(onDone).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(saveButton()).toBeDisabled()
    })

    deferred.release()
    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
  })

  /// The bug this screen carried: deleting the description and saving submitted a
  /// body with no `description` key at all, which the server read as "leave it
  /// alone". Clearing has to arrive as an empty string.
  it("submits a cleared description as empty so the server can clear it", async () => {
    const { update } = renderEditor()

    fireEvent.change(screen.getByTestId("product-description"), { target: { value: "" } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith("prd_1", expect.objectContaining({ description: "" }))
  })

  it("surfaces the server's message and stays on the form", async () => {
    const { onDone } = renderEditor({
      update: vi.fn().mockRejectedValue(new Error("Title already used")),
    })

    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByText("Error: Title already used")).toBeInTheDocument()
    })
    expect(onDone).not.toHaveBeenCalled()
    expect(saveButton()).toBeEnabled()
  })

  it("falls back to a generic message when the failure carries none", async () => {
    renderEditor({ update: vi.fn().mockRejectedValue("nope") })

    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(screen.getByText("Error: Could not save the product")).toBeInTheDocument()
    })
  })

  it("offers a cancel action, which only navigates", () => {
    const { update, onCancel } = renderEditor()

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})