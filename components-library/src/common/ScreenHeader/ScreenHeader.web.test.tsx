import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Text, View } from "react-native"
import { ScreenHeader } from "./ScreenHeader"

describe("ScreenHeader (web, via react-native-web)", () => {
  it("renders the title text", () => {
    render(<ScreenHeader title="Marketplace" />)
    expect(screen.getByText("Marketplace")).toBeInTheDocument()
  })

  it("renders a subtitle when provided", () => {
    render(<ScreenHeader title="Marketplace" subtitle="Fresh finds near you" />)
    expect(screen.getByText("Fresh finds near you")).toBeInTheDocument()
  })

  it("renders a trailing node alongside the title", () => {
    render(
      <ScreenHeader
        title="Cart"
        trailing={<View testID="settings-cog" accessibilityLabel="Settings" />}
      />,
    )
    expect(screen.getByText("Cart")).toBeInTheDocument()
    expect(screen.getByTestId("settings-cog")).toBeInTheDocument()
  })

  // The web stub for react-native-safe-area-context always returns { top: 0,
  // ... } (see components-library/stubs/react-native-safe-area-context.js), so
  // the wrapper's web-rendered paddingTop is exactly the visual breathing
  // space — no SafeArea contribution to subtract. Pin it so a refactor that
  // adds an unconditional `pt-2` (or drops the breathing room) fails here
  // rather than only on a real device.
  it("adds the visual breathing room on top of the safe-area inset", () => {
    render(<ScreenHeader title="Marketplace" testID="hdr" />)
    const node = screen.getByTestId("hdr")
    // `paddingTop` is a CSS number in px — react-native-web emits it as the
    // numeric style value, equal to the breathing-space constant.
    expect(node.style.paddingTop).toBe("8px")
  })

  it("drops the breathing room in compact mode (back-button + title rows)", () => {
    render(<ScreenHeader title="Product" compact testID="hdr" />)
    expect(screen.getByTestId("hdr").style.paddingTop).toBe("0px")
  })

  // Truncates a long title rather than letting it push the trailing control
  // off the row (e.g. the settings cog in the cart screenshot).
  it("truncates a long title rather than wrapping the row", () => {
    render(<ScreenHeader title="This is a very long title that should truncate" testID="hdr" />)
    const title = screen.getByText("This is a very long title that should truncate")
    expect(title).toBeInTheDocument()
  })

  it("exposes a default testID that callers can target", () => {
    render(<ScreenHeader title="Wishlist" />)
    expect(screen.getByTestId("screen-header")).toBeInTheDocument()
  })

  it("accepts a custom testID override", () => {
    render(<ScreenHeader title="Wishlist" testID="wishlist-title" />)
    expect(screen.getByTestId("wishlist-title")).toBeInTheDocument()
  })

  it("renders a custom trailing element as a sibling, not a child, of the title", () => {
    render(
      <ScreenHeader
        title="Cart"
        trailing={<Text testID="trailing-text">1</Text>}
      />,
    )
    const cog = screen.getByTestId("trailing-text")
    expect(cog).toBeInTheDocument()
    // The title and the trailing element share a parent (the row), so the
    // trailing element's parent is *not* the title text node.
    expect(cog.parentElement).not.toBe(screen.getByText("Cart"))
  })
})