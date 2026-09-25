# react-native-and-web

Boilerplate monorepo sharing a React Native component library between a
Next.js (SSR) web app and an Expo React Native app, plus a NestJS + Prisma +
PostgreSQL API. No business logic — just the scaffolding, wired end to end
and verified running (dev servers, production builds, Vitest, Playwright,
Storybook, and Metro bundling were all actually executed while building
this, not just configured on paper).

## Stack

- **`components-library`** — shared UI. Components are written with React
  Native primitives (`View`, `Text`, `Pressable`) styled with
  [NativeWind](https://www.nativewind.dev) (Tailwind `className`s). On web
  they render through [react-native-web](https://necolas.github.io/react-native-web/);
  on native, through Expo. This is the actual mechanism that maximizes
  sharing between the two apps — the same `Button` component renders,
  unmodified, on both.
- **`web-application`** — Next.js 16, App Router, SSR (Turbopack).
- **`mobile-application`** — Expo SDK 57 (managed), React Navigation,
  TanStack Query, Zustand.
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

cp api/.env.example api/.env
docker compose up -d
pnpm --filter @rnw/api prisma migrate dev

pnpm dev   # runs web-application, mobile-application, and api dev servers via turbo
```

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

## Common commands

```bash
pnpm turbo run build --dry-run          # inspect the task graph
pnpm turbo run lint typecheck test build   # everything, cached

pnpm --filter @rnw/components-library storybook          # http://localhost:6006
pnpm --filter @rnw/components-library build-storybook     # static export
pnpm --filter @rnw/web-application dev                    # http://localhost:3000
pnpm --filter @rnw/mobile-application start                # Metro / Expo Go
pnpm --filter @rnw/mobile-application prebuild && npx expo export --platform ios  # bundle check, no simulator
pnpm --filter @rnw/api dev                                 # http://localhost:3001

pnpm --filter @rnw/web-application test:e2e                # Playwright
pnpm --filter @rnw/mobile-application test:e2e:build && pnpm --filter @rnw/mobile-application test:e2e  # Detox
```
