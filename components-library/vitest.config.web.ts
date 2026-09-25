import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Renders RN-primitive components through react-native-web into jsdom, like
// Next.js does at runtime. jsxImportSource is forced to plain "react" since
// NativeWind's cssInterop can't be reached through Vitest's module
// execution (README); class-output fidelity is covered by Storybook/Playwright instead.
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
