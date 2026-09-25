import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { HomeIcon } from "./HomeIcon"

describe("HomeIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<HomeIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<HomeIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
