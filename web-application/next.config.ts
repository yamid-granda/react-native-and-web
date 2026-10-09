import type { NextConfig } from "next"
import { WEB_RESOLVE_EXTENSIONS, webResolveAlias } from "../components-library/web-resolution"

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
  // The marketplace used to live at `/marketplace` with details at
  // `/marketplace/[id]`; it is now the home page (`/`) with details at
  // `/product/[id]`. Permanent redirects preserve backlinks and crawlers.
  async redirects() {
    return [
      { source: "/marketplace", destination: "/", permanent: true },
      { source: "/marketplace/:id", destination: "/product/:id", permanent: true },
    ]
  },
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
    // Same list as both Vitest configs, Storybook and esbuild — see
    // web-resolution.ts. It only applies to project files, not to
    // node_modules, which is why react-native-svg needs the resolveAlias
    // above rather than being resolved here.
    resolveExtensions: [...WEB_RESOLVE_EXTENSIONS],
  },
  // Only exercised if the app is built/run with `--no-turbopack`.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "react-native-safe-area-context$": safeAreaContextStubPath,
      "react-native$": "react-native-web",
    }
    // Deliberately its own list rather than WEB_RESOLVE_EXTENSIONS: this
    // *prepends* to Next's own defaults, so it only has to carry the `.web.*`
    // preference, whereas resolveExtensions above replaces the list outright.
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
