import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  // The specs need the e2e fixture products (`prod-1`), which `db:seed`
  // deliberately does not write — these two hooks put them in and take them back
  // out again, so the dev database is left with only real data.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    // Locally, reuse an already-running `next dev`. In CI, build first and
    // run `next start` for a production-parity SSR check.
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
})
