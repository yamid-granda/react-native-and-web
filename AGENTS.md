# Repository Guide

This is a pnpm/Turborepo monorepo for a Next.js web app and an Expo mobile app. Both apps share UI from `components-library`; `api-rs` is a Rust/Axum read API backed by PostgreSQL.

## Workspaces

- `components-library/src/common/` — reusable UI components; `src/business/` — shared screens and state; `src/icons/` — icons.
- `web-application/` — Next.js App Router app and Playwright end-to-end tests. Read its `AGENTS.md` before changing web code.
- `mobile-application/src/app/` — Expo Router routes and layouts; keep non-route code outside `src/app/`. Read its `AGENTS.md` before changing mobile code.
- `api-rs/src/` — Axum router, handlers, cache tiers, and middleware; `api-rs/prisma/` — schema, migrations, and seed data (api-rs owns these; see its `README.md`).
- `improve-proposals/` — feature proposals and implemented proposal records.

## Architecture and implementation

- Before changing cross-platform UI or app wiring, read the relevant section of `README.md`, especially **Architecture boundaries and known gotchas**. It records platform constraints that are easy to reintroduce accidentally.
- UI used by both apps belongs in `components-library` and should be imported by both. Keep platform routing and app-specific wiring in thin app wrappers; only split implementations when platform behavior genuinely requires it.
- Shared components use React Native primitives and NativeWind. Follow nearby component, test, and Storybook patterns rather than introducing a second styling or state approach.
- Keep route definitions in each app's existing router. Do not move app-specific routing into the shared library.
- Use pnpm (version pinned in the root `package.json`) and the existing workspace scripts. Do not edit generated output such as `api-rs/generated/prisma/` directly; update the Prisma schema and use `api-rs`'s `db:migrate`/`db:seed` scripts instead.
- Check the relevant scoped `AGENTS.md` and installed framework documentation before changing Next.js or Expo APIs; versions and conventions may differ from prior releases.

## Common commands

Run from the repository root:

```bash
pnpm install
pnpm dev                  # start the dev tasks (api-rs serves the API on 3001)
pnpm lint
pnpm typecheck
pnpm test                 # workspace unit/component tests; not end-to-end tests
pnpm build
```

Useful focused checks:

```bash
pnpm --filter @rnw/components-library test
pnpm --filter @rnw/web-application test:e2e   # Playwright; starts Next.js dev server locally
pnpm --filter @rnw/api-rs test:e2e           # hermetic Postgres/Valkey E2E; requires Docker
pnpm --filter @rnw/mobile-application test:e2e # Detox; requires a native build and simulator
```

Run the narrowest relevant checks for a change, then broader checks when practical. Report checks that could not run and why (for example, missing PostgreSQL or a mobile simulator). See `README.md` for service setup, Storybook, and native build details.

## Working conventions

- Make the smallest change that fits the existing architecture. Add or update tests alongside behavior changes and follow the nearest tests' conventions.
- Prefer clear names and simple code. Add comments only for non-obvious constraints or decisions; put repo-wide explanations in `README.md`.
- Use Conventional Commits for commit messages. Never commit or push unless explicitly asked; do not perform destructive git operations without explicit approval.
- Keep shared UI in `components-library`; read `.agents/rules/component-reuse.md` before changing cross-platform UI.
- See `.agents/rules/` for the full project policies. Before using a task workflow, read its matching skill in `.agents/skills/`; reusable role prompts are in `.agents/agents/`.
