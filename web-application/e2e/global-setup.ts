import { execFileSync } from "node:child_process"

/**
 * The specs click `product-card-prod-1` and assert its `$129.99` price, so they
 * need the e2e fixture products in the database api-rs is serving.
 *
 * `db:seed` deliberately writes none — a dev marketplace should hold only what
 * sellers create through the app — so the fixtures are an explicit, opt-in step
 * here, undone in `global-teardown.ts`.
 *
 * `pnpm --filter` finds the workspace root from any subdirectory, so this works
 * whatever cwd Playwright hands the hook.
 */
export default function globalSetup(): void {
  try {
    execFileSync("pnpm", ["--filter", "@rnw/api-rs", "db:seed-fixtures"], { stdio: "inherit" })
  } catch {
    throw new Error(
      "could not seed the e2e fixtures. api-rs needs to be reachable and its DATABASE_URL " +
        "set (api-rs/.env) — see web-application/AGENTS.md for the e2e setup.",
    )
  }
}
