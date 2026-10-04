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

  it("names the field it belongs to", () => {
    render(<Label htmlFor="auth-email">Email</Label>)
    expect(screen.getByText("Email")).toHaveAttribute("aria-label", "Email label")
  })
})