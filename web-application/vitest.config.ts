import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { WEB_RESOLVE_EXTENSIONS, webResolveAlias } from "../components-library/web-resolution"

// Tests this app's own integration of the shared component library, distinct
// from components-library's own suites. jsxImportSource forced to "react"
// for the same reason as components-library/vitest.config.web.ts.
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    // Same contract as components-library/vitest.config.web.ts, owned by the same
    // module; only the two stub paths differ, because they resolve from this
    // package root rather than from components-library's. See web-resolution.ts.
    alias: webResolveAlias({
      safeAreaContext: path.resolve(
        __dirname,
        "../components-library/stubs/react-native-safe-area-context.js",
      ),
      svg: "react-native-svg/lib/module/ReactNativeSVG.web.js",
    }),
    extensions: [...WEB_RESOLVE_EXTENSIONS],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.tsx"],
    server: {
      // react-native-svg is otherwise treated as an external SSR dep and
      // loaded via plain Node require(), bypassing the alias/extensions
      // above — which crashes on its Flow-typed native-only entry point.
      deps: {
        inline: ["react-native-svg"],
      },
    },
  },
})
