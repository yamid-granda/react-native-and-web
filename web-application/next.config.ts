import type { NextConfig } from "next"
import { webResolveAlias } from "../components-library/web-resolution"

// Stubs react-native-safe-area-context, which breaks web bundling; see
// README. Reached from a browser chunk (BottomNav calls useSafeAreaInsets),
// so — same as the react-native-svg stub below — this has to be a plain
// project-root-relative path: a file:// resolveAlias target gets treated as
// an external, which Turbopack's browser chunking doesn't support.
const safeAreaContextStubPath = "../components-library/stubs/react-native-safe-area-context.js"

// Turbopack's `resolveExtensions` (below) doesn't get react-native-svg to
// its web build — see the stub for why — so route it there directly.
const reactNativeSvgStubPath = "../components-library/stubs/react-native-svg.js"

const nextConfig: NextConfig = {
  // react-native / react-native-web / nativewind ship untranspiled source;
  // Next.js needs to run its own transforms over them.
  transpilePackages: [
    "@rnw/components-library",
    "react-native",
    "react-native-web",
    "nativewind",
    "react-native-css-interop",
  ],
  // Next.js 16 defaults to Turbopack, which ignores the `webpack()` function
  // below — the react-native -> react-native-web alias has to go through
  // this key instead.
  turbopack: {
    // Same alias contract as the two Vitest configs and Storybook, owned by the
    // same module. Unlike them, react-native-svg needs the stub here rather than
    // its real web entry — Turbopack's resolveExtensions does not reach into
    // node_modules (see stubs/react-native-svg.js).
    resolveAlias: webResolveAlias({
      safeAreaContext: safeAreaContextStubPath,
      svg: reactNativeSvgStubPath,
    }),
    // Mirrors the webpack `resolve.extensions` below, for project files that
    // ship their own `.web.*` variant. Turbopack only applies this to
    // project files, not to node_modules — react-native-svg needs the
    // resolveAlias above instead.
    resolveExtensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".mjs",
      ".json",
    ],
  },
  // Only exercised if the app is built/run with `--no-turbopack`.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "react-native-safe-area-context$": safeAreaContextStubPath,
      "react-native$": "react-native-web",
    }
    config.resolve.extensions = [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ...(config.resolve.extensions ?? []),
    ]
    return config
  },
}

export default nextConfig
