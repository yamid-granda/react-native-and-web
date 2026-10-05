# react-native-and-web

Boilerplate monorepo sharing a React Native component library between a
Next.js (SSR) web app and an Expo React Native app, plus a Rust + Axum + sqlx
marketplace read API on PostgreSQL. No business logic — just the scaffolding,
wired end to end and verified running (dev servers, production builds, Vitest,
Playwright, Storybook, and Metro bundling were all actually executed while
building this, not just configured on paper).

## Stack

- **`components-library`** — shared UI, in two Storybook categories:
  - `src/common/` — generic, reusable primitives (`Button`, `Input`, `Label`).
  - `src/business/` — full app screens (`HomeScreen`, used unmodified as
    both mobile-application's Home tab and web-application's `/` page,
    including its Zustand-backed counter state and its My Store entry;
    `AuthScreen`, `StoreScreen`, `ProductFormScreen` and `PublicStoreScreen`
    for the seller storefront).

  Components are written with React Native primitives (`View`, `Text`,
  `Pressable`) styled with [NativeWind](https://www.nativewind.dev)
  (Tailwind `className`s). On web they render through
  [react-native-web](https://necolas.github.io/react-native-web/); on
  native, through Expo. This is the actual mechanism that maximizes sharing
  between the two apps.
- **`web-application`** — Next.js 16, App Router, SSR (Turbopack).
- **`mobile-application`** — Expo SDK 57 (managed), React Navigation,
  TanStack Query.
- **`api-rs`** — Rust + Axum + sqlx read API serving the contract both clients
  default to, with optional Valkey L2 caching, rate limiting, and OpenTelemetry
  tracing. It is the only API in the repo, and it is Rust-only: schema, queries,
  and migrations all live in `api-rs/`, with no Node toolchain in the loop.
- pnpm workspaces + Turborepo for task orchestration/caching.
- Vitest for unit/component tests (web-flavored RN components, plain
  TypeScript utils); Playwright for web e2e; Detox for native e2e.

## Prerequisites

- **Node ≥ 20.19 / 22.12.** A `.node-version` file pins `22.23.3` — with
  [fnm](https://github.com/Schniz/fnm) installed, run `fnm use` in the repo
  root.
- **A Docker runtime** — Docker Desktop or, lighter-weight on macOS,
  [Colima](https://colima.run): `brew install colima docker && colima start`.
  Needed for `docker-compose.yml` (Postgres/Valkey/Prometheus/Grafana) and for
  `api-rs`'s testcontainers-based E2E suite. api-rs resolves Colima's socket
  (`~/.colima/<profile>/docker.sock`) itself, so no `DOCKER_HOST` export is
  needed; an explicitly set `DOCKER_HOST` always wins.
- **pnpm** (`packageManager` is pinned in the root `package.json`).
- **Rust stable** (api-rs pins 1.99.0 through rustup in `api-rs/rust-toolchain.toml`).
  On macOS the linker additionally needs the Xcode license accepted
  (`sudo xcodebuild -license accept`); until that is done every cargo
  build/test/clippy run fails at link time with
  `linking with 'cc' failed: ... You have not agreed to the Xcode license`.
  `cargo-llvm-cov` (only for the `coverage` script), `k6` (only for
  `load-tests/`), and `critcmp` (only for benchmark diffs) are optional
  installs.

## Getting started

```bash
pnpm install   # onlyBuiltDependencies in pnpm-workspace.yaml pre-approves
               # esbuild/sharp's postinstall scripts — no manual
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

### API — Rust (api-rs)

Serves the marketplace API on the contract port the web and mobile apps default
to. Needs Postgres running, once:

```bash
docker compose up -d
cp api-rs/.env.example api-rs/.env
pnpm --filter @rnw/api-rs db:migrate
pnpm --filter @rnw/api-rs db:seed
```

Then:

```bash
pnpm --filter @rnw/api-rs dev
```

→ http://localhost:3001 (`GET /health`, `GET /metrics`). For environment
variables, cache and rate-limit setup, migrations/seed ownership, and E2E
tests, see [`api-rs/README.md`](api-rs/README.md).

### Storybook — components-library

```bash
pnpm --filter @rnw/components-library storybook
```

→ http://localhost:6006

### All apps together

```bash
pnpm dev
```

Runs web-application, mobile-application, api-rs, and Storybook together via
Turborepo (`turbo run dev`), output interleaved in one terminal. api-rs serves
the contract port 3001 that both clients default to; Grafana (from
`docker compose`) uses 3002. Postgres and Valkey should be started first with
`docker compose up -d` and the migrations applied as above.

## Architecture boundaries and known gotchas (read before "fixing" these)

- **NativeWind only supports the Next.js `/pages` router or `"use client"`
  routes** (no RSC support yet). `web-application` uses the App Router for
  layout/routing, but any subtree rendering shared components is behind a
  `"use client"` boundary (see `app/page.tsx`, `app/providers.tsx`,
  `app/ssr-styles-wrapper.tsx`). It's still server-rendered to HTML and
  hydrated (confirmed: `curl localhost:3000` returns real markup with the
  button's Tailwind classes and an SSR-injected react-native-web
  stylesheet) — just not RSC-streamed for those subtrees.
- **Routing is Expo Router (mobile) + Next.js App Router (web), unified at
  the nav-bar level by Solito.** `mobile-application` uses **Expo Router**
  (routes in `src/app/`, per its own `AGENTS.md`) — not React Navigation
  directly, though Expo Router is what actually renders the tabs/stack
  underneath. Screen-level routing stays platform-native on both sides
  (`expo-router`'s `router`/`useLocalSearchParams` on mobile, Next's
  `useRouter`/typed `params` on web) — Solito is used narrowly, only where
  navigation code is genuinely shared: `components-library`'s `MainNav`.
  See the `MainNav`/`BottomNav` bullets below for how the nav bar itself
  works on each platform.
- **Solito's native `useLink`/`useRouter` only work with *bare* React
  Navigation — not Expo Router.** Verified from source, not assumed: Expo
  Router (SDK 57) fully vendors its own internal fork of
  `@react-navigation/native`/`bottom-tabs`/`native-stack`
  (`expo-router/build/react-navigation/`, `build/fork/NavigationContainer.js`)
  and lists **no** `@react-navigation/*` package as a dependency or
  peerDependency at all. Solito's native `use-link-to.native.js` imports
  `useLinkTo` from the *external* `@react-navigation/native` package — a
  completely different module instance with no matching context, since
  Expo Router never renders that package's providers; calling it throws
  ("Couldn't find a navigation object"). `MainNav.tsx` (native) therefore
  never imports Solito at all and stays exactly as it was, onPress-driven;
  only `MainNav.web.tsx` (a separate file, Metro/Vite platform resolution)
  uses `solito/navigation`'s `useLink()`, where the web implementation is a
  safe, plain wrapper over `next/navigation`. Neither adapter imports the
  other's `MainNavItem`, and the item body neither imports has no idea which
  platform resolved its press behaviour.
- **`expo-router/ui`'s `<TabList>` only discovers `<TabTrigger>`s among its
  own direct, unwrapped children.** Verified from source
  (`expo-router/build/ui/Tabs.js`'s `parseTriggersFromChildren`): it walks
  `Tabs`'s own `children` prop with `Children.forEach`, recursing *only*
  into `Fragment` or `TabList` elements — anything else (a plain `View`, or
  a custom component like `BottomNav`) is skipped without recursing into
  it at all, even if a `TabTrigger` is nested inside. This ruled out reusing
  `BottomNav`'s wrapping JSX for the mobile tab bar entirely (an earlier
  `renderItems` render-prop design was tried and reverted once this was
  confirmed) — `mobile-application/src/app/(tabs)/_layout.tsx` instead
  builds the bar directly from a flat `<TabList>` (cast locally for
  `className`, non-`asChild` to avoid `expo-router/ui`'s `Slot` — which
  throws on an *array* `style` prop, see its own `Slot.js` — merging with
  `BottomNav`'s own default `justifyContent: 'space-between'`), with
  `TabTrigger asChild`-wrapping the shared `MainNav` for each item. It
  reuses `BOTTOM_NAV_BAR_CLASSNAME`/`BOTTOM_NAV_MIN_GAP`/`nativeOverlayStyle`
  (exported from `BottomNav.tsx`) so the two stay visually identical without
  duplicating the safe-area math.
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
- **api-rs is Rust-only, and it owns its schema.** `api-rs/migrations/` is the
  single source of truth for the database, applied by sqlx's embedded migrator
  (`sqlx::migrate!`, tracked in `_sqlx_migrations`). `pnpm --filter @rnw/api-rs
  db:migrate` and `db:seed` run the `api-rs-db` binary — both are Rust, and
  both read `api-rs/.env`. Don't reintroduce Prisma, Diesel, or any second
  migration system: one toolchain, one migration owner. Because the migrator is
  embedded in the binary, adding a migration also requires a rebuild to take
  effect; `api-rs/build.rs` handles that by emitting
  `cargo:rerun-if-changed=migrations`.
- **`api-rs-db` is not shipped in the container.** The Dockerfile builds
  `--bin api-rs` only, so migrations run from a checkout (`cargo run --bin
  api-rs-db`) rather than from inside a deployed instance.
- **`db:seed` writes no products, and that is deliberate.** The dev marketplace
  holds only what sellers create through the app; the demo seller exists so you
  can log in and be one. The fixed products the Playwright and Detox specs click
  (`prod-1`) live behind `db:seed-fixtures`, which those suites' global-setup and
  global-teardown hooks pair so a run leaves the database as it found it. Don't
  fold fixture products back into `db:seed` — that is what puts fake catalogue
  rows in a developer's marketplace.
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
  Because `vitest.config.web.ts` lists `.web.tsx` **first** in
  `resolve.extensions` and only globs `src/**/*.web.test.tsx`, the *native*
  half of a platform-split component was structurally unreachable from
  `pnpm test` — only `tsc` and Detox ever loaded it. That is the other
  reason `Product` and `MainNav` keep a shared, unsuffixed body
  (`ProductCard.tsx`, `MainNavItem.tsx`): it is testable by the one project
  that exists. The adapters themselves are still not rendered by any Vitest
  project — the props each one computes are verified by `tsc`, and on native
  by Detox.
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
  `foreground`, `muted`, `surface`, `surface-muted`, `border`, `border-muted`) to
  `rgb(var(--color-x) / <alpha-value>)`; components use those names
  (`bg-surface`, `text-muted`, ...) instead of pairing a light utility with
  a `dark:` variant. The values live in exactly one place,
  `components-library/tokens.css`, which each global stylesheet imports
  (`web-application/app/globals.css`, `mobile-application/global.css`,
  `components-library/global.css`) instead of restating. It owns the one
  dark-mode selector set too: a `:root` light block, an OS-driven
  `@media (prefers-color-scheme: dark)` block, and `:root.light`/`:root.dark`
  overrides. All three Tailwind configs use `darkMode: "class"`. Web's Theme
  button toggles a `.light`/`.dark` class on the document element and
  Storybook's backgrounds toolbar does the same, so both outrank the OS block;
  the mobile tab bar's Theme item cannot, because `toggleColorScheme` calls
  `Appearance.setColorScheme` and there is no DOM on native for a class to live
  on, so native dark mode follows the OS appearance. That is why the OS block
  selects a bare `:root` and not `:root:not(.light)`: the latter is equivalent
  on web, but React Native CSS Interop builds its light/dark root variables from
  a bare `:root` and silently drops any other selector, which would leave native
  rendering the light palette in dark mode with nothing failing.
  `tokens.parity.test.ts` pins all of it and fails if a stylesheet stops
  importing `tokens.css` or restates a `--color-*` value. One-off colors that
  don't change with the scheme (e.g. `bg-brand`) stay as plain Tailwind
  utilities.
- **The neutral ramp is an elevation ladder, and `border` is not `surface-muted`.**
  `background` → `surface` → `surface-muted` is a hierarchy where each step has
  to stay visible against the one below it: a card is `#ffffff` on a `#f4f4f5`
  canvas in light, and `#202024` on a `#09090b` canvas in dark (1.10:1 / 1.23:1).
  Shadows can't be relied on for this — `ProductCard` uses `shadow-sm`, which is
  near-invisible against a near-black canvas — so the fill carries elevation in
  both schemes. `border` exists because `surface-muted` used to be the outline of
  a control *and* the fill of a pressed state *and* the placeholder behind a
  missing image, and only the first of those has to clear 3:1 against both its
  neighbours under WCAG 1.4.11. Clearing 3:1 is a floor rather than a target,
  though, and aiming straight at it overshoots: it is roughly twice the weight of
  iOS's `systemGray4`, and a form repeats that edge down the whole page. So there
  are two weights. `border` (3.43:1) is for *actions* — `Button`'s `secondary`
  variant, which is singular and needs to read as actionable. `border-muted`
  (1.77:1, the `systemGray4` weight) is for *fields* — `Input`, which repeats and
  should stay quiet — and is a deliberate, documented deviation from 1.4.11,
  matching what Apple and Material ship for an outlined field. A decorative
  separator such as `BottomNav`'s top divider keeps `surface-muted`, since 1.4.11
  covers boundaries needed to identify a control, not hairlines.
  `tokens.parity.test.ts` asserts every step of the ladder, both border weights,
  and every text/background pair in both schemes, so a ramp change that breaks
  legibility fails a test instead of shipping.
- **Every button is `components-library`'s `Button`, and every button and
  input is one height.** `Button` is the only place a button look is written
  down: its two variants — `primary` (filled brand, the one primary
  call-to-action per view) and `secondary` (bordered, surface-filled, everything
  else) — are exported alongside the component, as is `BUTTON_VARIANTS`, the
  approved list. There are deliberately **no size variants**: every button is the
  one default size, and sizes come back as a proposal rather than as a `size`
  prop added in passing. A third variant is likewise a proposal, not a feature
  implementation — see `.agents/rules/button-variants.md`.
  `Button.variants.web.test.tsx` pins the list, requires each variant to have its
  own Storybook story, and fails if a `size` prop reappears; the `AllVariants`
  story renders off `BUTTON_VARIANTS`, so the matrix can't fall behind the union.
  Height isn't a Button
  decision at all — `tailwind-preset.cjs` defines a `h-control` token
  (2.75rem/44px), which `Button` and `Input` both apply, and which no component
  may restate as
  a literal `h-*`/`py-*`. The token lives in the shared preset rather than a
  CSS custom property because native can't read one (same reason the semantic
  colors above are `rgb(var(--x))` utilities rather than raw CSS). A few
  `accessibilityRole="button"` surfaces are deliberately *not* Buttons and are
  listed, with reasons, in `Button.centralization.test.ts`'s allowlist: the
  `MainNav` nav items, the `Product` card (navigating, and its nested wishlist
  toggle must stay a sibling `<button>`, not a child one), the `Drawer`
  overlay click-catcher, and the dev-only `IconsGallery` preview card. A test
  fails if anything else sets `accessibilityRole`, so a hand-rolled button
  can't come back. `Button`'s `testId` is required and is never derived from
  `label`, which a `toButtonTestId(label)` helper used to do: a derived id moves
  whenever the words on screen move, so rewording a button, `loading` swapping
  its label for "…", a label carrying a product title, or a counter ("Pressed 3
  times") each drag a selector out from under the tests using it — and making
  the prop mandatory is also what forces a button repeated per list row to be
  unique, which Playwright's strict mode requires anyway. Ids are kebab-case and
  screen-scoped (`cart-checkout`, `checkout-place-order`, `sort-price-asc`,
  `store-edit-${id}`), so one route's button can't be mistaken for another's,
  and icon buttons are no exception (`drawer-close`, `wishlist-toggle-${id}`)
  since they are the ones most likely to be untargetable. The prop is spelled
  `testId`, not RN's `testID`, because it is `Button`'s own prop that happens to
  be forwarded to the platform's `testID`. A button that toggles between two of
  the variants also passes `selected` to announce which one is current —
  `selected` paints nothing, so the visible half of "this one is on" is the
  variant itself, as `ProductFilterControls` does with the current sort.
- **`web-application`'s Theme toggle can't just call NativeWind's
  `setColorScheme` and trust its `colorScheme` state.** On web that state
  is hardcoded to `"light"` on mount regardless of the real OS preference
  (confirmed empirically — it only reflects reality once you explicitly
  set it), and NativeWind only ever adds a `.dark` class, never a `.light`
  one, so an explicit light pick can't override an OS-dark `@media` block.
  `app/use-theme-toggle.ts` computes the real initial theme itself
  (`localStorage`, falling back to `window.matchMedia`), toggles both
  classes directly, and still calls `setColorScheme` so
  `components-library`'s own token CSS stays in sync; `globals.css`'s
  `@media (prefers-color-scheme: dark)` block is guarded with
  `:root:not(.light)` so an explicit light pick can win over a dark OS
  default, alongside a plain `:root.dark` override for the reverse case.
  The choice is persisted to `localStorage` as a safety net for whatever
  *does* still reload the page (a manual refresh, a typed-in URL) — same
  issue the cart store hit. Nav-bar clicks themselves no longer reload at
  all now that `MainNav.web.tsx` routes `href` through `solito/navigation`'s
  `useLink()` (a real Next.js client-side transition, confirmed via
  Playwright: a `window` marker set before a click survives it), but the
  persistence is kept regardless since those other reload paths remain.
  `mobile-application` doesn't need any of this: there's no page-reload
  navigation, and `useColorScheme`'s `toggleColorScheme` works correctly on
  native.
- **`MainNav` is platform-split (`MainNav.tsx` native, `MainNav.web.tsx`
  web)**, not one file with internal branching — see the Solito bullet
  above for why (native must never import `solito/navigation` at all).
  The split is *two thin adapters over one body*, not two components: both
  adapters do nothing but resolve how a press becomes navigation
  (`accessibilityRole`/`onPress` vs. `solito`'s `useLink()` `href`) and hand
  it to `MainNavItem.tsx`, which holds the icon, badge and title once.
  `MainNavItem.tsx` is where `Pressable` is cast locally, same reasoning as
  the `Button.tsx` cast above: react-native-web's `View` (which `Pressable`
  wraps) recognizes an `href` prop and renders an `<a>` instead of a
  `<div>`, but RN's own `PressableProps`/`ViewProps` types don't know about
  this react-native-web-only behavior. Both *adapters* are also wrapped in
  `forwardRef` — `expo-router/ui`'s `TabTrigger asChild` needs to forward a
  `ref` to whatever it clones, which a plain function component can't
  receive — and each passes it down to the item.
  `Product` follows the same shape (`ProductCard.tsx` is the body; the two
  adapters only supply the image element, since `expo-image` and
  react-native-web's `Image` take different props).
  The rule of thumb: **split the file, not the component** — extract a shared
  body when the difference is an import or a platform prop, but leave a pair
  alone when the difference is a rendering strategy (`ProductListScreen`'s
  `FlatList` vs. a CSS grid, which stays split).
- **`MainNav.web.tsx` adds `shrink overflow-hidden` to the item's own
  classes**, and `MainNavItem.tsx` does not. This is deliberate: both are
  meaningful to Yoga, so hoisting them into the shared body would be a
  native layout change. They are passed through `MainNavItem`'s `className`
  prop instead, and can move once `mobile-application`'s
  `e2e/tab-bar-position.e2e.ts` plus a visual check of a 5-item bar at a
  narrow width can confirm native is unaffected.
- **react-native-web's `Text` hardcodes `color: 'black'`** instead of
  inheriting it (`exports/Text/index.js`). `MainNav` used to work around
  this by giving its label `text-current` (`color: currentColor`) so it
  would resolve against the ancestor `Pressable`'s actual computed color —
  that only works on web. `currentColor` has no CSS cascade to resolve
  against on native (react-native-svg's `stroke` prop and RN's `Text`
  don't understand it as anything but a literal, meaningless string);
  confirmed by NativeWind's own compiler, which flags `text-current` as an
  `IncompatibleNativeValue` and silently emits no style rule for it at all.
  The natural cross-platform fix, NativeWind's `group`/`group-active`
  variant, also isn't implemented in the installed version — verified: no
  `"group"` handling anywhere in `react-native-css-interop`'s source.
  `MainNav` instead reads `Pressable`'s own `pressed` render-prop (core RN
  API, identical on both platforms) and picks `text-muted`/`text-brand`
  directly for both the icon and the label — no CSS-inheritance trick, no
  platform branching, same code on both platforms.
- **`IconBase` registers with `nativewind`'s `cssInterop`** so a
  `className`/token color (e.g. `text-muted`) resolves to a real `stroke`
  color on native, not just on web: `cssInterop(IconBaseImpl, { className:
  { target: "style", nativeStyleToProp: { color: true } } })` — the same
  recipe `react-native-css-interop` uses to register its own
  `ActivityIndicator` (a component whose color also arrives via a plain
  prop, not a `style` object; see `react-native-css-interop`'s
  `components.js`).
- **Rendering a `cssInterop`-wrapped component isn't reachable under
  Vitest**, for the same reason `vitest.config.web.ts` already forces
  `jsxImportSource: "react"` instead of NativeWind's own JSX runtime
  (below): calling into `cssInterop`'s real runtime crashes trying to load
  react-native internals, the same class of failure as the
  `react-native-svg` one below, just at render time instead of import
  time. `components-library` and `web-application`'s Vitest setup files
  each mock `nativewind`'s `cssInterop` as an identity function so
  `IconBase` still renders in tests via its plain `color`-prop fallback;
  real Metro/Next builds use the real `cssInterop` untouched.
- **Storybook's esbuild dep-optimizer needs an explicit JSX loader for
  `react-native-css-interop`.** Its `dist/doctor.js` ships inline JSX in a
  plain `.js` file, which esbuild's default `.js` loader can't parse ("The
  JSX syntax extension is not currently enabled") — `.storybook/main.ts`
  sets `optimizeDeps.esbuildOptions.loader: { ".js": "jsx" }` to fix it,
  the same way it already overrides `resolveExtensions` for
  `react-native-svg`.
- **A write has to invalidate the public cache, and api-rs's list keys cannot be
  enumerated.** `GET /products?page=N` is cached under
  `products:list:<generation>:<page bits>`, so there is no list of "every page a
  shopper has asked for" to walk when a price changes. The write path bumps that
  namespace generation instead — one `INCR`, after which every previously cached
  page is simply unreachable — and calls `invalidate_detail(id)` *before* it, so
  a reader can never pair a fresh detail entry with a list filled before the
  write. Three list families fold in the counter: the marketplace, a public
  storefront, and `products:count` (which is the field `total` comes from). The
  generation is held in process rather than read per request, so the cost is
  bounded staleness on instances that did not perform the write — see
  `api-rs/ARCHITECTURE.md` §12 for the arithmetic rather than assuming it is
  still 5 s.
- **A credential does not get the cart's storage.** `useCartStore`,
  `useWishlistStore`, `useRecentlyViewedStore` and `useSessionStore` all share
  one `createPersistStorage` helper (`localStorage` on web, an in-memory `Map` on
  native), which is right for a cart and wrong for a session token: on native the
  token is dropped on any JS reload, so the seller is silently signed out, and on
  web `localStorage` is readable by any script on the page. The honest fixes are
  `expo-secure-store` for native — which costs a development build for the whole
  mobile app, since a new native module means Expo Go stops being enough — and an
  `httpOnly` cookie session for web. Both are recorded as follow-ups in
  `components-library/src/business/AuthScreen/useSessionStore.ts`; neither is
  something to bolt on silently.
- **`BottomNav` (rendered directly by `web-application`; mobile builds an
  equivalent bar from its exports — see the `TabList` bullet above) floats
  over content with a real transparent `marginBottom`, not a filled
  spacer.** The gap below the bar (safe-area inset + a minimum gap) needs
  to show whatever's actually scrolled underneath it (e.g. marketplace
  product cards) rather than a solid color — a separate filled `View` there
  would opaquely cover that content instead. On web this falls out of
  `position: fixed` for free: content already scrolls underneath the bar.
  On native it doesn't by default — `fixed` compiles to nothing there
  (`IncompatibleNativeValue`), and a fully custom tab bar is otherwise laid
  out as a normal, non-overlapping flex sibling (screen content sized to
  end exactly where the bar begins). `nativeOverlayStyle` sets `position:
  "absolute"` via inline style on native only (a Tailwind class can't
  express this — same class of gap as the `currentColor` one above) so the
  bar floats the same way web's `fixed` does; `inset-x-0`/`bottom-0`/`z-50`
  already compile fine on native and anchor/stack it correctly once it's
  taken out of flex flow. `ProductListScreen`/`CartScreen` (both plain
  `ScrollView`s with no bottom inset reserved) get this scroll-under effect
  for free on both platforms; a non-scrolling screen with content genuinely
  pinned to the bottom edge
  would need its own bottom inset and doesn't currently have one.

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

### api-rs tests

| Kind | Command | Requires |
| --- | --- | --- |
| Unit tests | `pnpm --filter @rnw/api-rs test` | — |
| Hermetic E2E + contract parity | `pnpm --filter @rnw/api-rs test:e2e` | Docker |
| **All tests (unit + E2E)** | `pnpm --filter @rnw/api-rs test:all` | Docker |
| Coverage gate (80% lines) | `pnpm --filter @rnw/api-rs coverage` | `cargo-llvm-cov` |
| Benchmarks | `pnpm --filter @rnw/api-rs bench` | — |
| Lint (fmt + clippy) | `pnpm --filter @rnw/api-rs lint` | — |
| Typecheck | `pnpm --filter @rnw/api-rs typecheck` | — |

`test:all` chains `test` and `test:e2e`. It is not named `test`, so
`pnpm turbo run test` keeps skipping the Docker-dependent E2E suite. Load tests
have no `pnpm` script — see [Performance testing and
monitoring](#performance-testing-and-monitoring).

## Performance testing and monitoring

The api-rs k6 steady/spike/soak scenarios and SLO thresholds are in
[`load-tests/README.md`](load-tests/README.md).
Start `docker compose up -d` for Valkey, Prometheus, Grafana, and the OTLP
collector; the pre-provisioned RED/cache/pool dashboard is at
http://localhost:3002 when Grafana is running (admin / rnw, override the host
port with `GRAFANA_PORT`). Prometheus scrapes api-rs at
`host.docker.internal:3001`, which is where `pnpm --filter @rnw/api-rs dev`
listens. Configure a production CDN using
[`monitoring/cloudflare.md`](monitoring/cloudflare.md); cache headers alone do
not make Cloudflare cache arbitrary API JSON.
