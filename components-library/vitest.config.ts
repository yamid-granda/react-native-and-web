import { defineConfig } from "vitest/config";

/**
 * Root entry point: ties the Vitest projects (web, utils) together so
 * `pnpm test` runs both in one invocation. Using the `projects` field
 * (Vitest 3.2+) rather than a standalone vitest.workspace.ts, which is
 * deprecated.
 *
 * There's no separate "native" project: `vitest-native` (real RN JS,
 * mocking only the native boundary) hit a reproducible dual-module-instance
 * bug in this environment — `@testing-library/react-native`'s `render()`
 * and its `screen` singleton ended up backed by two different loaded
 * copies of `test-renderer` (one via Node `require`, one via Vite's
 * "module" resolution), so `screen` never saw what `render()` wrote. This
 * is the documented fallback: components-library's components are RN
 * primitives, so testing them through react-native-web (the "web" project)
 * is still a faithful, working way to unit-test them with Vitest — just
 * without vitest-native's real-RN-internals fidelity.
 */
export default defineConfig({
  test: {
    projects: ["./vitest.config.web.ts", "./vitest.config.utils.ts"],
  },
});
