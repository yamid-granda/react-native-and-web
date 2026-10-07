import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { Path } from "react-native-svg"
import { IconBase } from "./IconBase"
import { ICON_FOREGROUND_DARK } from "./iconColor"

// Simulates a native host in dark mode: react-native-svg never resolves
// "currentColor" there, so a bare icon must come out with an explicit
// dark foreground stroke instead of falling back to black.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>()
  return {
    ...actual,
    Platform: { ...(actual as { Platform: object }).Platform, OS: "ios" },
    useColorScheme: () => "dark",
  }
})

describe("IconBase on native dark mode", () => {
  it("strokes a bare icon with the dark foreground, not currentColor/black", () => {
    const { container } = render(
      <IconBase>
        <Path d="M0 0h10v10H0z" />
      </IconBase>,
    )
    expect(container.querySelector("path")?.getAttribute("stroke")).toBe(ICON_FOREGROUND_DARK)
  })

  it("still honors an explicit color over the scheme default", () => {
    const { container } = render(
      <IconBase color="#2563eb">
        <Path d="M0 0h10v10H0z" />
      </IconBase>,
    )
    expect(container.querySelector("path")?.getAttribute("stroke")).toBe("#2563eb")
  })
})
