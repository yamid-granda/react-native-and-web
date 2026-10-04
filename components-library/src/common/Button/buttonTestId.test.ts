import { describe, expect, it } from "vitest"
import { toButtonTestId } from "./buttonTestId"

describe("toButtonTestId", () => {
  it("lowercases the label and dashes its spaces", () => {
    expect(toButtonTestId("Add to Cart")).toBe("add-to-cart")
  })

  it("collapses punctuation into single dashes", () => {
    expect(toButtonTestId("Price: Low to High")).toBe("price-low-to-high")
  })

  it("collapses runs of spaces, dashes and punctuation", () => {
    expect(toButtonTestId("Go  to — Cart!")).toBe("go-to-cart")
  })

  it("trims leading and trailing separators", () => {
    expect(toButtonTestId("  Remove!  ")).toBe("remove")
  })

  it("leaves digits alone", () => {
    expect(toButtonTestId("Page 2")).toBe("page-2")
  })
})
