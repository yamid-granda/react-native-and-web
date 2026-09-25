import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

// esbuild (Vitest's default) doesn't emit emitDecoratorMetadata correctly for
// Nest's DI, so tests compile through SWC instead.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
  plugins: [swc.vite()],
});
