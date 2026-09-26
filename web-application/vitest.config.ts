import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"

// Tests this app's own integration of the shared component library, distinct
// from components-library's own suites. jsxImportSource forced to "react"
// for the same reason as components-library/vitest.config.web.ts.
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    alias: {
      "react-native": "react-native-web",
      "react-native-svg": "react-native-svg/lib/module/ReactNativeSVG.web.js",
    },
    // react-native-svg ships separate native/.web.js implementations and
    // relies on Metro's RN platform-extension resolution to pick the right
    // one; Vite doesn't do that by default, so the plain .js (native,
    // Flow-typed) file gets bundled instead and fails to parse. Same fix as
    // components-library/vitest.config.web.ts.
    extensions: [
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
