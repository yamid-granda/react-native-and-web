import path from "node:path"
import { pathToFileURL } from "node:url"
import type { NextConfig } from "next"

// Stubs react-native-safe-area-context, which breaks web bundling; see README.
const safeAreaContextStubPath = path.resolve(
  __dirname,
  "../components-library/stubs/react-native-safe-area-context.js",
)
// Turbopack's resolveAlias wants a file:// URL for absolute paths, not a
// plain OS path — plain paths get misread as project-root-relative.
const safeAreaContextStubUrl = pathToFileURL(safeAreaContextStubPath).href

// Turbopack's `resolveExtensions` (below) doesn't get react-native-svg to
// its web build — see the stub for why — so route it there directly. Unlike
// the safe-area-context stub above, this one is reached from a browser
// chunk: a file:// URL resolveAlias target gets treated as an external,
// which Turbopack's browser chunking doesn't support, so this stays a plain
// project-root-relative path instead.
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
    resolveAlias: {
      "react-native-safe-area-context": safeAreaContextStubUrl,
      "react-native-svg": reactNativeSvgStubPath,
      "react-native": "react-native-web",
    },
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
