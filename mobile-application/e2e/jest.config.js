// Detox's own Jest runner — isolated from the repo's Vitest tasks; never merged.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: "..",
  testMatch: ["<rootDir>/e2e/**/*.e2e.ts"],
  testTimeout: 120000,
  maxWorkers: 1,
  // Wrappers around Detox's own hooks, so the e2e fixture products exist for the
  // run and are removed again afterwards — `db:seed` deliberately writes none.
  globalSetup: "<rootDir>/e2e/global-setup.js",
  globalTeardown: "<rootDir>/e2e/global-teardown.js",
  reporters: ["detox/runners/jest/reporter"],
  testEnvironment: "detox/runners/jest/testEnvironment",
  verbose: true,
}
