import { describe, expect, it } from "vitest"
import { render } from "@testing-library/react"
import { Path } from "react-native-svg"
import { IconBase } from "./IconBase"

describe("IconBase (web, via react-native-web)", () => {
  it("renders its children", () => {
    expect(() =>
      render(
        <IconBase>
          <Path d="M0 0h10v10H0z" />
        </IconBase>,
      ),
    ).not.toThrow()
  })

  it("accepts a custom size and color", () => {
    expect(() =>
      render(
        <IconBase size={48} color="#2563eb">
          <Path d="M0 0h10v10H0z" />
        </IconBase>,
      ),
    ).not.toThrow()
  })

  it("lets a child override the default stroke props", () => {
    expect(() =>
      render(
        <IconBase>
          <Path d="M0 0h10v10H0z" strokeWidth={4} />
        </IconBase>,
      ),
    ).not.toThrow()
  })
})
