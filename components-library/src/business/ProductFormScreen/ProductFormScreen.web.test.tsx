import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ProductFormScreen, parse } from "./ProductFormScreen"

const product = {
  id: "prd_1",
  title: "Leather Weekender Bag",
  description: "Full-grain leather.",
  price: 189,
  currency: "USD",
  imageUrl: "https://example.test/bag.png",
  stock: 6,
}

const submitButton = () => screen.getByRole("button", { name: /Create product|Save changes/ })

function fill(testID: string, value: string) {
  fireEvent.change(screen.getByTestId(testID), { target: { value } })
}

function fillValid() {
  fill("product-title", "Leather Weekender Bag")
  fill("product-price", "189")
  fill("product-stock", "6")
}

describe("ProductFormScreen (web, via react-native-web)", () => {
  it("creates when no product is supplied and edits when one is", () => {
    const { unmount } = render(<ProductFormScreen onSubmit={vi.fn()} />)
    expect(screen.getByText("Add product")).toBeInTheDocument()
    unmount()

    render(<ProductFormScreen product={product} onSubmit={vi.fn()} />)
    expect(screen.getByText("Edit product")).toBeInTheDocument()
    // Prefilled from the product being edited.
    expect(screen.getByTestId("product-title")).toHaveValue("Leather Weekender Bag")
    expect(screen.getByTestId("product-price")).toHaveValue("189")
    expect(screen.getByTestId("product-stock")).toHaveValue("6")
    expect(screen.getByTestId("product-image-url")).toHaveValue("https://example.test/bag.png")
  })

  it("calls onSubmit with the parsed values", async () => {
    const onSubmit = vi.fn()
    render(<ProductFormScreen onSubmit={onSubmit} />)

    fillValid()
    fill("product-description", "  Full-grain leather.  ")
    fill("product-image-url", "https://example.test/bag.png")
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        title: "Leather Weekender Bag",
        description: "Full-grain leather.",
        price: 189,
        imageUrl: "https://example.test/bag.png",
        stock: 6,
      })
    })
  })

  /// The regression this shape exists for: a cleared field is submitted as `""`,
  /// not omitted. Omitting it made the server read "leave it alone", so the
  /// seller deleted a description, got a successful save, and the text stayed.
  it("submits a cleared optional field as empty rather than omitting it", async () => {
    const onSubmit = vi.fn()
    render(<ProductFormScreen onSubmit={onSubmit} />)

    fillValid()
    fill("product-description", "   ")
    fill("product-image-url", "")
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ description: "", imageUrl: "" })
      )
    })
  })

  it("defaults stock to zero when it is left blank", async () => {
    const onSubmit = vi.fn()
    render(<ProductFormScreen onSubmit={onSubmit} />)

    fill("product-title", "Sticker")
    fill("product-price", "0")
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ price: 0, stock: 0 }))
    })
  })

  it("blocks submission on an empty title", () => {
    const onSubmit = vi.fn()
    render(<ProductFormScreen onSubmit={onSubmit} />)

    fill("product-price", "10")
    fireEvent.click(submitButton())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId("product-form-error")).toHaveTextContent("Title is required")
  })

  it("blocks submission on a negative price", () => {
    const onSubmit = vi.fn()
    render(<ProductFormScreen onSubmit={onSubmit} />)

    fill("product-title", "Mug")
    fill("product-price", "-1")
    fireEvent.click(submitButton())

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByTestId("product-form-error")).toHaveTextContent("must not be negative")
  })

  it("surfaces the server's error message", () => {
    render(<ProductFormScreen onSubmit={vi.fn()} error={new Error("Title already used")} />)
    expect(screen.getByText("Error: Title already used")).toBeInTheDocument()
  })

  /// The submitting flag is the *caller's*, not the form's: the form has no api
  /// layer, so the app that owns the mutation is the one that knows. The only
  /// thing this owns is awaiting `onSubmit`, so a caller can set its own flag and
  /// see the button go inert.
  it("disables the save button while the caller reports a submission in flight", () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<ProductFormScreen onSubmit={onSubmit} />)
    fillValid()

    rerender(<ProductFormScreen onSubmit={onSubmit} isSubmitting />)
    expect(submitButton()).toBeDisabled()

    rerender(<ProductFormScreen onSubmit={onSubmit} />)
    expect(submitButton()).not.toBeDisabled()
  })

  it("awaits an async onSubmit, so the caller can flip isSubmitting", async () => {
    let release = () => {}
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    render(<ProductFormScreen onSubmit={onSubmit} />)
    fillValid()
    fireEvent.click(submitButton())

    expect(onSubmit).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  })

  it("offers a cancel action only when one is injected", () => {
    const onCancel = vi.fn()
    const { unmount } = render(<ProductFormScreen onSubmit={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalled()
    unmount()

    render(<ProductFormScreen onSubmit={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument()
  })
})

describe("parse", () => {
  const fields = { title: "Mug", description: "", price: "18", imageUrl: "", stock: "3" }

  it("mirrors the server's rules", () => {
    expect(parse(fields)).toEqual({
      title: "Mug",
      // Trimmed, and present: `""` is what tells the server to clear the column.
      description: "",
      price: 18,
      imageUrl: "",
      stock: 3,
    })
    expect(parse({ ...fields, description: "  Full-grain.  ", imageUrl: " https://a/b.png " })).toEqual(
      { title: "Mug", description: "Full-grain.", price: 18, imageUrl: "https://a/b.png", stock: 3 }
    )
    expect(parse({ ...fields, title: "  " })).toEqual({ error: "Title is required" })
    expect(parse({ ...fields, title: "x".repeat(201) })).toEqual({
      error: "Title must be at most 200 characters",
    })
    expect(parse({ ...fields, price: "" })).toEqual({ error: "Price is required" })
    expect(parse({ ...fields, price: "abc" })).toEqual({ error: "Price must be a number" })
    // `Number("")` is 0, which is why the empty check has to come first.
    expect(parse({ ...fields, price: "  " })).toEqual({ error: "Price is required" })
    expect(parse({ ...fields, price: "-0.01" })).toEqual({ error: "Price must not be negative" })
    // Zero is free, not invalid.
    expect(parse({ ...fields, price: "0" })).toEqual(expect.objectContaining({ price: 0 }))
    expect(parse({ ...fields, stock: "-1" })).toEqual({ error: "Stock must not be negative" })
    expect(parse({ ...fields, stock: "1.5" })).toEqual({ error: "Stock must be a whole number" })
    expect(parse({ ...fields, stock: "" })).toEqual(expect.objectContaining({ stock: 0 }))
  })
})