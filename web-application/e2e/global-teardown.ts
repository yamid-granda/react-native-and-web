import { execFileSync } from "node:child_process"

/**
 * Undoes `global-setup.ts`: takes the fixture products back out so the dev
 * database is left holding only real data.
 *
 * Only the fixture ids are deleted, so anything a seller created during the run
 * — and the demo seller itself — survives. Runs even when setup failed, because
 * a half-finished run that leaves fixtures behind is exactly the state this
 * exists to prevent.
 */
export default function globalTeardown(): void {
  try {
    execFileSync("pnpm", ["--filter", "@rnw/api-rs", "db:clear-fixtures"], { stdio: "inherit" })
  } catch {
    // Nothing useful to do here: the run has already reported its own failure, and
    // failing teardown on top of it would bury that. `pnpm --filter @rnw/api-rs
    // db:clear-fixtures` is idempotent, so the next run cleans up regardless.
    console.warn("could not clear the e2e fixtures — run `pnpm --filter @rnw/api-rs db:clear-fixtures`")
  }
}
