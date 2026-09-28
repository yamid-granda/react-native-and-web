import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { CloseIcon } from "./CloseIcon"

describe("CloseIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<CloseIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<CloseIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
