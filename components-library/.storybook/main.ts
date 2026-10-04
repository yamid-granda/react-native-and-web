import { fileURLToPath } from "node:url"
import type { StorybookConfig } from "@storybook/react-vite"
import { WEB_RESOLVE_EXTENSIONS, webResolveAlias } from "../web-resolution"

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
      ...webResolveAlias({
        safeAreaContext: fileURLToPath(
          new URL("../stubs/react-native-safe-area-context.js", import.meta.url),
        ),
        // react-native-svg's package.json "main" points at its native
        // (Flow-typed, requireNativeComponent-based) CJS build; only its
        // ESM tree has a browser-safe ReactNativeSVG.web.js, so point there
        // directly instead of relying on Metro-only platform-extension
        // resolution.
        svg: "react-native-svg/lib/module/ReactNativeSVG.web.js",
      }),
    }
    viteConfig.resolve.extensions = [...WEB_RESOLVE_EXTENSIONS]
    // esbuild's dep-optimizer bundles react-native-svg with its own separate
    // resolveExtensions, which does not inherit the list above, so it needs the
    // same one handed to it explicitly. react-native-svg must also stay in the
    // optimizer (not excluded) so esbuild still does its usual CJS->ESM interop
    // for its few `module.exports`-style files (e.g. lib/extract/transform.js).
    viteConfig.optimizeDeps ??= {}
    viteConfig.optimizeDeps.esbuildOptions = {
      ...viteConfig.optimizeDeps.esbuildOptions,
      resolveExtensions: [...WEB_RESOLVE_EXTENSIONS],
      // react-native-css-interop ships inline JSX in a .js file; see README
      loader: {
        ...viteConfig.optimizeDeps.esbuildOptions?.loader,
        ".js": "jsx",
      },
    }
    return viteConfig
  },
}

export default config
