import { defineConfig } from "vitest/config"

/** Plain TypeScript logic: no DOM, no RN — utils, but also state stores
 * colocated with their business screen (e.g. useCartStore.test.ts). */
export default defineConfig({
  test: {
    name: "utils",
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
})
