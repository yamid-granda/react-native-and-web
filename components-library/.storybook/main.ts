import { fileURLToPath } from "node:url"
import type { StorybookConfig } from "@storybook/react-vite"

// Web-only Storybook (react-native-web, Vite builder). @storybook/addon-react-native-web
// requires webpack5, so the alias it would set is configured directly below
// via viteFinal instead. safe-area-context stub: see README.
const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(viteConfig) {
    viteConfig.resolve ??= {}
    viteConfig.resolve.alias = {
      ...viteConfig.resolve.alias,
      "react-native-safe-area-context": fileURLToPath(
        new URL("../stubs/react-native-safe-area-context.js", import.meta.url),
      ),
      "react-native": "react-native-web",
      // react-native-svg's package.json "main" points at its native
      // (Flow-typed, requireNativeComponent-based) CJS build; only its
      // ESM tree has a browser-safe ReactNativeSVG.web.js, so point there
      // directly instead of relying on Metro-only platform-extension
      // resolution.
      "react-native-svg": "react-native-svg/lib/module/ReactNativeSVG.web.js",
    }
    viteConfig.resolve.extensions = [
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
    ]
    // esbuild's dep-optimizer bundles react-native-svg with its own
    // separate resolveExtensions (doesn't inherit the .web.js-first list
    // above), so its internal extension-less relative imports (e.g.
    // "./elements") resolve to the native, fabric/codegen-importing
    // files instead of the *.web.js ones. Mirror the list here too; the
    // package must stay in the optimizer (not excluded) so esbuild still
    // does its usual CJS->ESM interop for react-native-svg's few
    // `module.exports`-style files (e.g. lib/extract/transform.js).
    viteConfig.optimizeDeps ??= {}
    viteConfig.optimizeDeps.esbuildOptions = {
      ...viteConfig.optimizeDeps.esbuildOptions,
      resolveExtensions: [
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
      ],
      // react-native-css-interop (nativewind's cssInterop, used by IconBase)
      // ships inline JSX in a plain .js file (dist/doctor.js), which
      // esbuild's dep optimizer otherwise refuses to parse with its default
      // "js" loader.
      loader: {
        ...viteConfig.optimizeDeps.esbuildOptions?.loader,
        ".js": "jsx",
      },
    }
    return viteConfig
  },
}

export default config
