import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SearchInput } from "./SearchInput"

describe("SearchInput (web, via react-native-web)", () => {
  it("renders with the default placeholder and accessibility label", () => {
    render(<SearchInput value="" onChangeText={vi.fn()} />)
    expect(screen.getByLabelText("Search products")).toHaveAttribute(
      "placeholder",
      "Search products...",
    )
  })

  it("accepts a custom placeholder and accessibility label", () => {
    render(
      <SearchInput
        value=""
        onChangeText={vi.fn()}
        placeholder="Search icons..."
        accessibilityLabel="Search icons"
      />,
    )
    expect(screen.getByLabelText("Search icons")).toHaveAttribute("placeholder", "Search icons...")
  })

  it("calls onChangeText when typed into", () => {
    const onChangeText = vi.fn()
    render(<SearchInput value="" onChangeText={onChangeText} />)
    fireEvent.change(screen.getByLabelText("Search products"), { target: { value: "lamp" } })
    expect(onChangeText).toHaveBeenCalledWith("lamp")
  })

  it("renders the search icon", () => {
    const { container } = render(<SearchInput value="" onChangeText={vi.fn()} />)
    expect(container.querySelector("svg")).toBeInTheDocument()
  })
})
