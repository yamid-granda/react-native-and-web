import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { HeartIcon } from "./HeartIcon"

describe("HeartIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<HeartIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<HeartIcon size={48} color="#2563eb" />)).not.toThrow()
  })

  it("renders filled without throwing", () => {
    expect(() => render(<HeartIcon filled />)).not.toThrow()
  })
})
