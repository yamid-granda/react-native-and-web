# react-native-and-web

Boilerplate monorepo sharing a React Native component library between a
Next.js (SSR) web app and an Expo React Native app, plus a NestJS + Prisma +
PostgreSQL API. No business logic — just the scaffolding, wired end to end
and verified running (dev servers, production builds, Vitest, Playwright,
Storybook, and Metro bundling were all actually executed while building
this, not just configured on paper).

## Stack

- **`components-library`** — shared UI, in two Storybook categories:
  - `src/common/` — generic, reusable primitives (`Button`).
  - `src/business/` — full app screens (`HomeScreen`, used unmodified as
    both mobile-application's Home tab and web-application's `/` page,
    including its Zustand-backed counter state).

  Components are written with React Native primitives (`View`, `Text`,
  `Pressable`) styled with [NativeWind](https://www.nativewind.dev)
  (Tailwind `className`s). On web they render through
  [react-native-web](https://necolas.github.io/react-native-web/); on
  native, through Expo. This is the actual mechanism that maximizes sharing
  between the two apps.
- **`web-application`** — Next.js 16, App Router, SSR (Turbopack).
- **`mobile-application`** — Expo SDK 57 (managed), React Navigation,
  TanStack Query.
- **`api`** — NestJS 12 (ESM) + Prisma 7 (driver adapters) + PostgreSQL.
- pnpm workspaces + Turborepo for task orchestration/caching.
- Vitest for unit/component tests (web-flavored RN components, plain
  TypeScript utils, Nest); Playwright for web e2e; Detox for native e2e.

## Prerequisites

- **Node ≥ 20.19 / 22.12** (NestJS 12 requirement). A `.node-version` file
  pins `22.23.3` — with [fnm](https://github.com/Schniz/fnm) installed, run
  `fnm use` in the repo root.
- **Docker** (Postgres via `docker-compose.yml`) — not available in the
  environment this was built in, so the Prisma-backed `/health` check and
  `api`'s e2e test are configured and typechecked but not run against a
  real database. Everything else in this README was actually run.
- **pnpm** (`packageManager` is pinned in the root `package.json`).

## Getting started

```bash
pnpm install   # onlyBuiltDependencies in pnpm-workspace.yaml pre-approves
               # Prisma/esbuild/sharp's postinstall scripts — no manual
               # `pnpm approve-builds` step needed
```

Then see [Development](#development) below to run everything.

## Development

Each of these starts its own dev server. Run them in separate terminals, or
jump to [All four together](#all-four-together) to start every one of them
with a single command.

### Web app — Next.js

```bash
pnpm --filter @rnw/web-application dev
```

→ http://localhost:3000

### Mobile app — Expo

```bash
pnpm --filter @rnw/mobile-application start
```

Opens Expo dev tools with a QR code for Expo Go. To target a platform
directly instead:

```bash
pnpm --filter @rnw/mobile-application ios
pnpm --filter @rnw/mobile-application android
```

### API — NestJS

Needs Postgres running, once:

```bash
cp api/.env.example api/.env
docker compose up -d
pnpm --filter @rnw/api prisma migrate dev
```

Then:

```bash
pnpm --filter @rnw/api dev
```

→ http://localhost:3001 (`GET /health`)

### Storybook — components-library

```bash
pnpm --filter @rnw/components-library storybook
```

→ http://localhost:6006

### All four together

```bash
pnpm dev
```

Runs web-application, mobile-application, api, and Storybook together via
Turborepo (`turbo run dev`), output interleaved in one terminal — each
package defines a matching `"dev"` script (`next dev`, `expo start`,
`nest start --watch`, `storybook dev -p 6006`). The API's `/health` check
still needs the `cp .env` + `docker compose up -d` step above done first,
or it'll boot but fail to reach Postgres.

## Architecture boundaries and known gotchas (read before "fixing" these)

- **NativeWind only supports the Next.js `/pages` router or `"use client"`
  routes** (no RSC support yet). `web-application` uses the App Router for
  layout/routing, but any subtree rendering shared components is behind a
  `"use client"` boundary (see `app/page.tsx`, `app/providers.tsx`,
  `app/ssr-styles-wrapper.tsx`). It's still server-rendered to HTML and
  hydrated (confirmed: `curl localhost:3000` returns real markup with the
  button's Tailwind classes and an SSR-injected react-native-web
  stylesheet) — just not RSC-streamed for those subtrees.
- **Routing is not unified across platforms.** React Navigation lives only
  in `mobile-application`; Next.js App Router owns all web routing. Only
  screen/page *content* is shared, not navigation chrome. This is
  intentional, not an oversight.
- **`react-native-safe-area-context` is stubbed** (`components-library/stubs/`)
  for any Vite/webpack-bundled web context (Storybook, `web-application`'s
  `next.config.ts`). NativeWind's cssInterop unconditionally registers a
  `SafeAreaView` wrapper by `require`-ing the real package, whose build
  still statically imports a native-only codegen spec
  (`react-native/Libraries/Utilities/codegenNativeComponent`) with no
  react-native-web equivalent — this broke both Turbopack and Storybook's
  esbuild dep optimizer until stubbed. None of the web pages/stories render
  `SafeAreaProvider`/`SafeAreaView`, so a plain `View` standing in for it is
  enough. Mobile-application is unaffected (it uses the real package).
- **Prisma ORM 7 changed how the client connects.** `datasource.url` no
  longer lives in `schema.prisma` — the CLI (`migrate`, `studio`) reads it
  from `prisma.config.ts`, and `PrismaService` passes a `@prisma/adapter-pg`
  driver adapter to the `PrismaClient` constructor at runtime. Both need
  `DATABASE_URL` in the environment (`dotenv/config` is imported first
  thing in `main.ts` and in `vitest.setup.ts`).
- **Detox's test runner is Jest**, isolated in `mobile-application/e2e/`,
  and never mixed with the rest of the repo's Vitest tasks (`turbo run
  test`). This is a hard Detox constraint, not a deviation from "Vitest for
  React Native component testing" — that ask is about unit-testing
  components, which Detox doesn't do.
- **Detox needs a real built native app.** Expo Go isn't enough. Run
  `pnpm --filter @rnw/mobile-application prebuild` once (generates the
  gitignored `ios/`/`android/` folders via `expo-detox-config-plugin`),
  check the generated Xcode scheme name against `.detoxrc.js`'s
  placeholders, then `detox build`/`detox test`. Not runnable in the
  environment this was built in (no Xcode/Android SDK); `expo export
  --platform ios` (a full Metro bundle, no simulator needed) was used
  instead to confirm the app's dependency graph resolves and bundles
  correctly.
- **`components-library` has no separate "native" Vitest project.**
  `vitest-native` (real RN JS, mocking only the native boundary) hit a
  reproducible dual-module-instance bug: `@testing-library/react-native`'s
  `render()` and its `screen` singleton ended up backed by two different
  loaded copies of `test-renderer` (one via Node `require`, one via Vite's
  `"module"` resolution), so `screen` never saw what `render()` wrote.
  Component tests run through `vitest.config.web.ts` instead (jsdom +
  react-native-web) — components-library's components are RN primitives, so
  this is still a faithful, working way to unit-test them with Vitest, just
  without `vitest-native`'s real-RN-internals fidelity. That same jsdom
  config also forces `jsxImportSource: "react"` (overriding tsconfig's
  `"nativewind"` pragma) — NativeWind's runtime requires real react-native
  internals (including native-only paths like
  `codegenNativeComponent`) to wire up its cssInterop, which isn't
  reachable through Vitest's SSR-style module execution (it runs plain
  `require()` for dependency-of-a-dependency CJS files, bypassing Vite's
  `resolve.alias` entirely — confirmed by reproducing the exact same crash
  with a bare `node -e "require(...)"`). The tests assert render/
  interaction behavior, not literal Tailwind class output, so they don't
  need it — class-output fidelity is covered by Storybook (real Vite+esbuild
  browser build, where the dep optimizer *does* apply the alias
  transitively — confirmed via `curl`: the compiled story imports through
  `nativewind_jsx-dev-runtime`, and the served CSS contains the real
  compiled `bg-brand` utility) and the web-application Playwright suite
  (real Next.js/Turbopack build, same "full bundle" behavior).
- **`Button.tsx` casts `Pressable`/`Text` locally** instead of relying on
  NativeWind's ambient `className` type augmentation
  (`react-native-css-interop/types`). That augmentation doesn't cover
  `PressableProps` at all, and more fundamentally doesn't reliably merge
  across workspace packages that resolve to physically different
  `react-native` installs — which, before the `react`/`react-dom`/
  `react-native` versions were pinned to identical exact versions via the
  pnpm catalog (see `pnpm-workspace.yaml`), they did (Expo/Metro's own peer
  graph pulled a different `@react-native/metro-config` than
  web-application/components-library, so pnpm installed a separate
  physical copy).
- **`.npmrc` sets `node-linker=hoisted`.** Metro doesn't reliably walk
  pnpm's default strict, symlinked `node_modules` to find transitive deps
  of transitive deps (e.g. `react-native-css-interop`, a dependency of
  `nativewind` — `expo export` failed with "Unable to resolve module"
  until this was set). Hoisting trades pnpm's strict isolation for broad
  Metro/webpack compatibility, the standard tradeoff for pnpm + Expo
  monorepos — but it only reliably de-duplicates `react`/`react-dom`/
  `react-native` because their versions are pinned identically everywhere
  (see above); without that alignment, hoisting instead nests *multiple*
  React copies side by side, which silently breaks jsdom rendering (two
  live React instances — this actually happened once while setting this
  up, symptom: components render as an empty `<div />` with an `act()`
  warning about "Root").
- **Dark mode is driven by CSS variables, not `dark:` classes.**
  `tailwind-preset.cjs` maps semantic color names (`background`,
  `foreground`, `muted`, `surface`, `surface-muted`) to
  `rgb(var(--color-x) / <alpha-value>)`; components use those names
  (`bg-surface`, `text-muted`, ...) instead of pairing a light utility with
  a `dark:` variant. Each app's global stylesheet
  (`web-application/app/globals.css`, `mobile-application/global.css`,
  `components-library/global.css`) declares the actual `--color-*` values
  for light and redefines them for dark — web/mobile under
  `@media (prefers-color-scheme: dark)` (OS-driven, `darkMode: "media"`),
  Storybook under a `.dark` class instead (`darkMode: "class"` in its own
  `tailwind.config.cjs`) so its backgrounds-addon toolbar can toggle
  dark mode manually, independent of the host OS (see
  `.storybook/preview.tsx`). One-off colors that don't change with the
  scheme (e.g. `bg-brand`) stay as plain Tailwind utilities.
- **`MainNav` casts `Pressable` locally to accept `href`**, same reasoning
  as the `Button.tsx` cast above: react-native-web's `View` (which
  `Pressable` wraps) recognizes an `href` prop and renders an `<a>` instead
  of a `<div>`, but RN's own `PressableProps`/`ViewProps` types don't know
  about this react-native-web-only behavior.
- **react-native-web's `Text` hardcodes `color: 'black'`** instead of
  inheriting it (`exports/Text/index.js`), so a plain-color `Text` nested
  inside a colored/interactive ancestor (e.g. `MainNav`'s label, which needs
  to track the link's `text-muted`/`active:text-brand` press state) won't
  pick that color up by default. Give that `Text` `text-current` (`color:
  currentColor`) instead of its own color utility, so it resolves against
  the ancestor's actual computed color, the same mechanism `IconBase`'s
  `currentColor` default already relies on.

## Commit messages

Commits must follow [Conventional Commits
v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) (`type(scope):
description`, e.g. `fix(api): handle missing health check env var`). A
`commit-msg` git hook (`.husky/commit-msg`, installed via the root
`prepare` script when you run `pnpm install`) runs commitlint against
`commitlint.config.js` and rejects any commit whose message doesn't
conform — for every workspace, since the hook runs once per commit at the
repo root regardless of which package the commit touches.

## Other commands

```bash
pnpm turbo run build --dry-run             # inspect the task graph
pnpm turbo run lint typecheck test build   # everything, cached

pnpm --filter @rnw/components-library build-storybook   # static Storybook export
pnpm --filter @rnw/mobile-application prebuild && npx expo export --platform ios  # bundle check, no simulator

pnpm --filter @rnw/web-application test:e2e     # Playwright
pnpm --filter @rnw/mobile-application test:e2e:build && pnpm --filter @rnw/mobile-application test:e2e  # Detox
```
