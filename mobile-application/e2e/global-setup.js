const { execFileSync } = require("node:child_process")

/**
 * Detox owns the Jest hooks; this wraps them so the e2e fixture products exist
 * first. The specs tap `product-card-prod-1` and assert its `$129.99` price,
 * and `db:seed` deliberately writes no products — a dev marketplace should hold
 * only what sellers create through the app.
 *
 * `pnpm --filter` finds the workspace root from any subdirectory, so this works
 * whatever cwd Jest hands the hook.
 */
module.exports = async function globalSetup() {
  try {
    execFileSync("pnpm", ["--filter", "@rnw/api-rs", "db:seed-fixtures"], { stdio: "inherit" })
  } catch (error) {
    throw new Error(
      "could not seed the e2e fixtures. api-rs needs to be reachable and its DATABASE_URL " +
        `set (api-rs/.env). Original error: ${error.message}`,
    )
  }

  require("detox/runners/jest/globalSetup")()
}
