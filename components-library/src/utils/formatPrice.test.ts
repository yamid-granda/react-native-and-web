import { describe, expect, it } from "vitest"
import { formatPrice } from "./formatPrice"

describe("formatPrice", () => {
  it("formats a number as USD by default", () => {
    expect(formatPrice(129.99)).toBe("$129.99")
  })

  it("formats using the given currency", () => {
    expect(formatPrice(10, "EUR")).toBe("€10.00")
  })
})
