import { defineConfig } from "vitest/config"

/** Plain TypeScript utils: no DOM, no RN, just logic. */
export default defineConfig({
  test: {
    name: "utils",
    environment: "node",
    globals: true,
    include: ["src/utils/**/*.test.ts"],
  },
})
