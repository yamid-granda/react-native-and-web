import { describe, expect, it } from "vitest"
import { cn } from "./cn"

describe("cn", () => {
  it("merges class names and resolves tailwind conflicts", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4")
  })

  it("drops falsy values", () => {
    expect(cn("text-white", false, undefined, null, "font-bold")).toBe("text-white font-bold")
  })
})
