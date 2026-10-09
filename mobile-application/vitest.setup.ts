import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// cssInterop isn't reachable under Vitest — see components-library's README
vi.mock("nativewind", () => ({
  cssInterop: (Component: unknown) => Component,
}))
