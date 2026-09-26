import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { CartIcon } from "./CartIcon"

describe("CartIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<CartIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<CartIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
