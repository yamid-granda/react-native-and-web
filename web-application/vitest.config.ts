import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tests this app's own integration of the shared component library, distinct
// from components-library's own suites. jsxImportSource forced to "react"
// for the same reason as components-library/vitest.config.web.ts.
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.tsx"],
  },
});
