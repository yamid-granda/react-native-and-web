import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { MoonIcon } from "./MoonIcon"

describe("MoonIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<MoonIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<MoonIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
