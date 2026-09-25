import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

// Renders RN-primitive components through react-native-web into jsdom, like
// Next.js does at runtime. jsxImportSource is forced to plain "react" since
// NativeWind's cssInterop can't be reached through Vitest's module
// execution (README); class-output fidelity is covered by Storybook/Playwright instead.
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    alias: {
      "react-native": "react-native-web",
      "react-native-svg": "react-native-svg/lib/module/ReactNativeSVG.web.js",
    },
    // react-native-svg ships separate native/.web.js implementations and
    // relies on Metro's RN platform-extension resolution to pick the
    // right one; Vite doesn't do that by default, so the plain .js file
    // (native, Flow-typed) gets bundled instead and fails to parse.
    extensions: [".web.js", ".web.ts", ".web.tsx", ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"],
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
