/**
 * The web resolution contract, owned once.
 *
 * Every web bundler and web test runner in this repo resolves `react-native` to
 * `react-native-web` and prefers a `.web.*` sibling over its bare counterpart.
 * When a component gains a platform split, this list is what decides which copy
 * a given tool loads — so it is defined here instead of restated per config.
 *
 * Import it from a bundler or test-runner config only, never through
 * `src/index.ts`: routing it via the barrel would pull the react-native module
 * graph into a config file's module graph, which is the very thing the aliases
 * below exist to prevent. That is also why this module holds strings and arrays
 * and nothing else — no component or `src/` import.
 */

/**
 * Vite / esbuild extension order, `.web.js` first.
 *
 * The order is not cosmetic: react-native-svg's web build reaches its DOM shapes
 * through an extensionless `from './elements'`, which only resolves to
 * `elements.web.js` when `.web.js` outranks `.js`.
 *
 * Spread it (`[...WEB_RESOLVE_EXTENSIONS]`) rather than assigning it straight
 * into a config, so a tool that mutates its own `extensions` array cannot reach
 * through it and corrupt the constant for every other tool sharing the process.
 */
export const WEB_RESOLVE_EXTENSIONS = [
  ".web.js",
  ".web.ts",
  ".web.tsx",
  ".mjs",
  ".js",
  ".mts",
  ".ts",
  ".jsx",
  ".tsx",
  ".json",
] as const

/**
 * The alias every web context needs, so the three module names that cannot be
 * left alone are one decision rather than four.
 *
 * Both targets are parameters because the two stub paths are reached from two
 * different package roots: Vitest resolves them from the workspace, and Next
 * needs project-root-relative strings that Turbopack will accept as
 * `resolveAlias` values.
 */
export function webResolveAlias(stubs: { safeAreaContext: string; svg: string }) {
  return {
    "react-native": "react-native-web",
    "react-native-safe-area-context": stubs.safeAreaContext,
    "react-native-svg": stubs.svg,
  } as const
}
