import { describe, expect, it } from "vitest"
import {
  ICON_FOREGROUND_DARK,
  ICON_FOREGROUND_LIGHT,
  resolveIconColor,
} from "./iconColor"

// Guards the mobile dark-mode regression: on native, react-native-svg has
// no `currentColor` cascade, so a bare icon defaulting to it renders black
// regardless of scheme. The default must resolve to an explicit foreground.
describe("resolveIconColor", () => {
  it("lets an explicit color win on every platform", () => {
    expect(resolveIconColor("#2563eb", "ios", "dark")).toBe("#2563eb")
    expect(resolveIconColor("#2563eb", "android", "light")).toBe("#2563eb")
    expect(resolveIconColor("#2563eb", "web", "dark")).toBe("#2563eb")
  })

  it("defaults to currentColor on web, where DOM inheritance resolves it", () => {
    expect(resolveIconColor(undefined, "web", "light")).toBe("currentColor")
    expect(resolveIconColor(undefined, "web", "dark")).toBe("currentColor")
  })

  it("defaults to the light foreground on native light mode", () => {
    expect(resolveIconColor(undefined, "ios", "light")).toBe(ICON_FOREGROUND_LIGHT)
    expect(resolveIconColor(undefined, "android", "light")).toBe(ICON_FOREGROUND_LIGHT)
  })

  it("defaults to the dark foreground on native dark mode, never currentColor/black", () => {
    expect(resolveIconColor(undefined, "ios", "dark")).toBe(ICON_FOREGROUND_DARK)
    expect(resolveIconColor(undefined, "android", "dark")).toBe(ICON_FOREGROUND_DARK)
  })

  it("falls back to the light foreground when the scheme is unknown", () => {
    expect(resolveIconColor(undefined, "ios", null)).toBe(ICON_FOREGROUND_LIGHT)
    expect(resolveIconColor(undefined, "ios", undefined)).toBe(ICON_FOREGROUND_LIGHT)
  })

  // Pins the exact values to tokens.css's --color-foreground (zinc-900 /
  // zinc-50): a near-miss white (e.g. a misparsed rgb() string) is visible
  // next to token-driven text in dark mode.
  it("matches the --color-foreground token values exactly", () => {
    expect(ICON_FOREGROUND_LIGHT).toBe("#18181b")
    expect(ICON_FOREGROUND_DARK).toBe("#fafafa")
  })
})
