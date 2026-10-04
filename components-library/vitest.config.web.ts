import path from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import { WEB_RESOLVE_EXTENSIONS, webResolveAlias } from "./web-resolution"

// Renders RN-primitive components through react-native-web into jsdom, like
// Next.js does at runtime. jsxImportSource is forced to plain "react" since
// NativeWind's cssInterop can't be reached through Vitest's module
// execution (README); class-output fidelity is covered by Storybook/Playwright instead.
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    // react-native-svg points at its own real web entry here rather than at the
    // stub Next.js needs: Vite applies resolve.extensions inside node_modules, so
    // there is nothing left to work around. See web-resolution.ts.
    alias: webResolveAlias({
      safeAreaContext: path.resolve(__dirname, "./stubs/react-native-safe-area-context.js"),
      svg: "react-native-svg/lib/module/ReactNativeSVG.web.js",
    }),
    extensions: [...WEB_RESOLVE_EXTENSIONS],
  },
  test: {
    name: "web",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.web.ts"],
    include: ["src/**/*.web.test.tsx"],
    server: {
      // react-native-svg is otherwise treated as an external SSR dep and
      // loaded via plain Node require(), bypassing the react-native ->
      // react-native-web alias above and the .web.js extension resolution
      // — which crashes on its Flow-typed native-only entry point.
      deps: {
        inline: ["react-native-svg"],
      },
    },
  },
})
