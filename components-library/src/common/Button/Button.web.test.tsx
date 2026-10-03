import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { Button } from "./Button"

describe("Button (web, via react-native-web)", () => {
  it("renders the label", () => {
    render(<Button label="Click me" />)
    expect(screen.getByText("Click me")).toBeInTheDocument()
  })

  it("calls onPress when clicked", () => {
    const onPress = vi.fn()
    render(<Button label="Click me" onPress={onPress} />)
    fireEvent.click(screen.getByText("Click me"))
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it("does not call onPress when disabled", () => {
    const onPress = vi.fn()
    render(<Button label="Click me" onPress={onPress} disabled />)
    const button = screen.getByRole("button", { name: "Click me" })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it("shows an ellipsis and refuses presses while loading", () => {
    const onPress = vi.fn()
    render(<Button label="Save changes" onPress={onPress} loading />)
    const button = screen.getByRole("button", { name: "Save changes" })
    expect(screen.queryByText("Save changes")).not.toBeInTheDocument()
    expect(screen.getByText("…")).toBeInTheDocument()
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(onPress).not.toHaveBeenCalled()
  })

  it("keeps its accessible name while loading", () => {
    // The visible label becomes "…", which on its own would leave a screen reader
    // with nothing to announce.
    render(<Button label="Save changes" loading />)
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument()
  })

  it("announces the busy state", () => {
    render(<Button label="Save changes" loading />)
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute(
      "aria-busy",
      "true"
    )
    render(<Button label="Go" />)
    expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("aria-busy", "false")
  })
})