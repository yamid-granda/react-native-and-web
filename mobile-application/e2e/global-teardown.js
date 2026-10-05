const { execFileSync } = require("node:child_process")

/**
 * Undoes `global-setup.js`: takes the fixture products back out so the dev
 * database is left holding only real data. Only the fixture ids are deleted, so
 * anything a seller created during the run — and the demo seller — survives.
 */
module.exports = async function globalTeardown() {
  await require("detox/runners/jest/globalTeardown")()

  try {
    execFileSync("pnpm", ["--filter", "@rnw/api-rs", "db:clear-fixtures"], { stdio: "inherit" })
  } catch {
    // Teardown failures would bury the run's own result, and the command is
    // idempotent — so warn with the command instead of throwing.
    console.warn(
      "could not clear the e2e fixtures — run `pnpm --filter @rnw/api-rs db:clear-fixtures`",
    )
  }
}
