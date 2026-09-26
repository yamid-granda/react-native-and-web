import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// nativewind's cssInterop wraps a component with real runtime machinery
// (color scheme subscriptions, style resolution) that isn't reachable
// through Vitest's forced jsxImportSource: "react" (see vitest.config.ts) —
// rendering a cssInterop-wrapped component crashes trying to load real
// react-native internals. Mocking it as an identity function lets IconBase
// (used transitively via @rnw/components-library's MainNav/BottomNav)
// render in tests via its plain color-prop fallback; the real Next.js build
// uses the real cssInterop.
vi.mock("nativewind", () => ({
  cssInterop: (Component: unknown) => Component,
}))
