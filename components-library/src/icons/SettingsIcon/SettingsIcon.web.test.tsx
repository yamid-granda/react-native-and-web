import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { SettingsIcon } from "./SettingsIcon"

describe("SettingsIcon (web, via react-native-web)", () => {
  it("renders with its default props", () => {
    expect(() => render(<SettingsIcon />)).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() => render(<SettingsIcon size={48} color="#2563eb" />)).not.toThrow()
  })
})
