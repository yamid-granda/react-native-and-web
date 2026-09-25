import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Tests the app's own integration of the shared component library (that
 * pages render it and wire providers correctly) — distinct from
 * components-library's own isolated Vitest suites.
 *
 * jsxImportSource is forced to plain "react" here, overriding tsconfig's
 * "nativewind" pragma — see components-library/vitest.config.web.ts for why:
 * NativeWind's runtime can't be reached through Vite/Vitest's SSR module
 * execution. The real Next.js dev server (Turbopack, full bundling) is
 * unaffected — this only applies to this Vitest project.
 */
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
