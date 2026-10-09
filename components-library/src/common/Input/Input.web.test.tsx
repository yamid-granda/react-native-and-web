import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { SearchIcon } from "../../icons/SearchIcon/SearchIcon"
import { Input, inputVerticalAlignStyle } from "./Input"

describe("Input (web, via react-native-web)", () => {
  it("renders the given value", () => {
    render(<Input value="hello" onChangeText={vi.fn()} accessibilityLabel="Example" />)
    expect(screen.getByLabelText("Example")).toHaveValue("hello")
  })

  it("calls onChangeText when typed into", () => {
    const onChangeText = vi.fn()
    render(<Input value="" onChangeText={onChangeText} accessibilityLabel="Example" />)
    fireEvent.change(screen.getByLabelText("Example"), { target: { value: "abc" } })
    expect(onChangeText).toHaveBeenCalledWith("abc")
  })

  it("renders a prepend icon when given one", () => {
    const { container } = render(
      <Input value="" onChangeText={vi.fn()} accessibilityLabel="Example" prependIcon={SearchIcon} />,
    )
    expect(container.querySelector("svg")).toBeInTheDocument()
  })

  it("renders no icon when prependIcon is omitted", () => {
    const { container } = render(
      <Input value="" onChangeText={vi.fn()} accessibilityLabel="Example" />,
    )
    expect(container.querySelector("svg")).not.toBeInTheDocument()
  })

  it("focuses the input when the prepend icon is clicked", () => {
    const { container } = render(
      <Input value="" onChangeText={vi.fn()} accessibilityLabel="Example" prependIcon={SearchIcon} />,
    )
    const icon = container.querySelector("svg")
    if (!icon) throw new Error("expected the prepend icon to render")
    fireEvent.click(icon)
    expect(screen.getByLabelText("Example")).toHaveFocus()
  })

  it("focuses the input when clicking anywhere in the container, not just the icon", () => {
    render(
      <Input value="" onChangeText={vi.fn()} accessibilityLabel="Example" prependIcon={SearchIcon} />,
    )
    fireEvent.click(screen.getByTestId("input-container"))
    expect(screen.getByLabelText("Example")).toHaveFocus()
  })

  it("keeps the container out of tab order so it isn't a second tab stop before the input", () => {
    render(
      <Input value="" onChangeText={vi.fn()} accessibilityLabel="Example" prependIcon={SearchIcon} />,
    )
    expect(screen.getByTestId("input-container")).toHaveAttribute("tabindex", "-1")
  })

  it("shows a text cursor over the whole container, not Pressable's default pointer", () => {
    render(
      <Input value="" onChangeText={vi.fn()} accessibilityLabel="Example" prependIcon={SearchIcon} />,
    )
    expect(screen.getByTestId("input-container")).toHaveStyle({ cursor: "text" })
  })

  it("gives the text field its own testID, distinct from the container's", () => {
    // The wrapper already claims `input-container`; a multi-field form needs a
    // selector that tells its fields apart.
    render(<Input inputTestID="product-title" value="" onChangeText={vi.fn()} />)
    expect(screen.getByTestId("product-title")).toBeInTheDocument()
    expect(screen.getAllByTestId("input-container")).toHaveLength(1)
  })

  it("renders a multiline field as a textarea that grows", () => {
    const { container } = render(<Input multiline inputTestID="notes" value="" onChangeText={vi.fn()} />)
    const textarea = container.querySelector("textarea")
    expect(textarea).not.toBeNull()
    expect(screen.getByTestId("notes")).toBe(textarea)
    // A one-line box centres its content; a tall one has to start at the top.
    expect(screen.getByTestId("input-container").className).not.toContain("items-center")
  })

  it("vertically centers single-line text so native matches web's <input>", () => {
    // The wrapper's `items-center` only centers the field view; the glyphs
    // inside need `textAlignVertical` + zero vertical padding on native.
    expect(inputVerticalAlignStyle(false)).toEqual({ paddingVertical: 0, textAlignVertical: "center" })
    expect(inputVerticalAlignStyle(undefined)).toEqual({
      paddingVertical: 0,
      textAlignVertical: "center",
    })
  })

  it("top-aligns multiline text so the first line does not float centered", () => {
    expect(inputVerticalAlignStyle(true)).toEqual({ paddingVertical: 0, textAlignVertical: "top" })
  })
})
