import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Label } from "./Label"

describe("Label (web, via react-native-web)", () => {
  it("renders its text", () => {
    render(<Label>Email</Label>)
    expect(screen.getByText("Email")).toBeInTheDocument()
  })

  it("replaces the text with the error, so the field keeps one caption", () => {
    render(<Label error="That is not an email address">Email</Label>)
    expect(screen.getByText("That is not an email address")).toBeInTheDocument()
    expect(screen.queryByText("Email")).not.toBeInTheDocument()
  })

  /// This component used to carry a test named "names the field it belongs to"
  /// that asserted the caption's own `aria-label` instead — there was no field
  /// in the render, and the string it checked ("Email label") appears nowhere on
  /// screen. The association is `FormField`'s to make and is asserted there.
  /// What is left for `Label` is that it stays out of the accessibility
  /// labelling business: an `aria-label` here would name the caption and leave
  /// the field anonymous.
  it("carries no accessible name of its own", () => {
    render(<Label>Email</Label>)
    expect(screen.getByText("Email")).not.toHaveAttribute("aria-label")
    expect(screen.getByText("Email")).not.toHaveAttribute("role")
  })
})