import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { MarketplaceIcon } from "./MarketplaceIcon"

describe("MarketplaceIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<MarketplaceIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<MarketplaceIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
