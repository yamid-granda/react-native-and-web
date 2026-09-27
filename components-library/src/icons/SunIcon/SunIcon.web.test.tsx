import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { SunIcon } from "./SunIcon"

describe("SunIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<SunIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<SunIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
