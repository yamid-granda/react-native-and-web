import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * "Web-flavored" project: renders RN-primitive components through
 * react-native-web into jsdom, exactly like Next.js does at runtime.
 *
 * jsxImportSource is forced to plain "react" here, overriding tsconfig's
 * "nativewind" pragma. NativeWind's runtime (react-native-css-interop)
 * ships compiled CJS that `require()`s real react-native's internals
 * (including deep native-only paths like
 * Libraries/Utilities/codegenNativeComponent) to wire up its cssInterop —
 * fine under Metro's bundler-wide resolver, but not reachable through
 * Vite/Vitest's SSR module execution even with resolve.alias/dep
 * optimization. These tests assert render/interaction behavior, not
 * literal Tailwind class output, so they don't need cssInterop at all —
 * className rendering fidelity is covered by Storybook (real Vite+RNW
 * build) and the web-application Playwright suite (real Next.js build).
 */
export default defineConfig({
  plugins: [react({ jsxImportSource: "react" })],
  resolve: {
    alias: {
      "react-native": "react-native-web",
    },
  },
  test: {
    name: "web",
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.web.ts"],
    include: ["src/**/*.web.test.tsx"],
  },
});
