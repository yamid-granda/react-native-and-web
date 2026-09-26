import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// see README "Architecture boundaries" (cssInterop isn't reachable under Vitest)
vi.mock("nativewind", () => ({
  cssInterop: (Component: unknown) => Component,
}))
