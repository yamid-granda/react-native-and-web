import { describe, expect, it, vi } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { AccessibilityInfo } from "react-native"
import { useReducedMotion } from "./useReducedMotion"

describe("useReducedMotion", () => {
  it("reports the OS / browser reduce-motion setting", async () => {
    vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true)
    const { result } = renderHook(() => useReducedMotion())
    await waitFor(() => expect(result.current).toBe(true))
  })

  it("starts with motion allowed until the setting resolves", () => {
    vi.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false)
    const { result } = renderHook(() => useReducedMotion())
    expect(result.current).toBe(false)
  })
})
