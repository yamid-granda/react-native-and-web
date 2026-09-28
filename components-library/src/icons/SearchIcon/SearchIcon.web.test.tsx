import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { SearchIcon } from "./SearchIcon"

describe("SearchIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<SearchIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<SearchIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
