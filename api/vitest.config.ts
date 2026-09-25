import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * Nest relies on `emitDecoratorMetadata` (reflect-metadata) for
 * constructor-based dependency injection. Vitest's default esbuild
 * transform doesn't emit that metadata correctly, so tests are compiled
 * through SWC instead via unplugin-swc — the standard Nest+Vitest pairing.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  plugins: [swc.vite()],
});
