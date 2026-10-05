import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { AuthScreen } from "../../business/AuthScreen/AuthScreen"
import { useSessionStore } from "../../business/AuthScreen/useSessionStore"
import { ProductFormScreen } from "../../business/ProductFormScreen/ProductFormScreen"
import { FormField } from "./FormField"

describe("FormField (web, via react-native-web)", () => {
  /// The whole finding, in one assertion. It is unwritable against a bare
  /// `Label` + `Input` pair, which is why `Label`'s own test had to settle for
  /// asserting the caption: nothing in that render carries the name `Email`.
  it("names the field, not the caption", () => {
    render(<FormField label="Email" inputTestID="auth-email" value="" onChangeText={vi.fn()} />)
    expect(screen.getByLabelText("Email")).toBe(screen.getByTestId("auth-email"))
    expect(screen.getByLabelText("Email").tagName).toBe("INPUT")
  })

  /// Without this, the assertion above could pass with the name still sitting on
  /// the caption: one node would satisfy both queries and nothing would have
  /// moved. The caption and the field have to be two things.
  it("keeps the caption and the field as two distinct nodes", () => {
    render(<FormField label="Email" inputTestID="auth-email" value="" onChangeText={vi.fn()} />)
    const caption = screen.getByText("Email")
    const field = screen.getByLabelText("Email")
    expect(caption).not.toBe(field)
    expect(caption.tagName).not.toBe("INPUT")
    // The caption is not carrying a name of its own any more, so the string that
    // used to be announced as "Email label" is gone from the markup entirely.
    expect(caption).not.toHaveAttribute("aria-label")
  })

  it("replaces the caption with the error, and keeps naming the field", () => {
    render(
      <FormField
        label="Email"
        error="That is not an email address"
        inputTestID="auth-email"
        value=""
        onChangeText={vi.fn()}
      />,
    )
    expect(screen.getByText("That is not an email address")).toBeInTheDocument()
    expect(screen.queryByText("Email")).not.toBeInTheDocument()
    // Named from `label`, not from whatever the caption currently reads.
    expect(screen.getByLabelText("Email")).toBe(screen.getByTestId("auth-email"))
  })

  it("lets a caller override the derived name deliberately", () => {
    render(
      <FormField
        label="Price"
        accessibilityLabel="Price in dollars"
        inputTestID="product-price"
        value=""
        onChangeText={vi.fn()}
      />,
    )
    expect(screen.getByLabelText("Price in dollars")).toBe(screen.getByTestId("product-price"))
    expect(screen.queryByLabelText("Price")).not.toBeInTheDocument()
  })

  it("forwards multiline and keeps the field's own testID distinct from the wrapper's", () => {
    const { container } = render(
      <FormField label="Description" inputTestID="notes" multiline value="" onChangeText={vi.fn()} />,
    )
    expect(screen.getByLabelText("Description")).toBe(container.querySelector("textarea"))
    expect(screen.getAllByTestId("input-container")).toHaveLength(1)
  })
})

/// The invariant `FormField` exists to make structural: a caption and a field
/// that agree, on every form in the library.
///
/// This is the check the eight hand-paired `htmlFor`/`inputTestID` strings never
/// had. Each call site wrote the same identifier twice — once as `htmlFor`, once
/// as `inputTestID` — and nothing compared them, so a field could be captioned
/// and still be anonymous while every test stayed green. Deriving both from one
/// string makes that unreachable, and this test is what says so.
describe("every captioned field on a form screen is named by its caption", () => {
  beforeEach(() => {
    useSessionStore.setState({ token: null, user: null, status: "anonymous" })
  })

  it("on the product form", () => {
    render(<ProductFormScreen onSubmit={vi.fn()} />)
    for (const [caption, inputTestID] of [
      ["Title", "product-title"],
      ["Description", "product-description"],
      ["Price", "product-price"],
      ["Stock", "product-stock"],
      ["Image URL", "product-image-url"],
    ] as const) {
      expect(screen.getByLabelText(caption), caption).toBe(screen.getByTestId(inputTestID))
    }
  })

  it("on the auth screen, including the field sign-up mode adds", () => {
    render(<AuthScreen onSubmit={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Create a store" }))
    for (const [caption, inputTestID] of [
      ["Email", "auth-email"],
      ["Password", "auth-password"],
      ["Store name", "auth-store-name"],
    ] as const) {
      expect(screen.getByLabelText(caption), caption).toBe(screen.getByTestId(inputTestID))
    }
  })
})
