# react-native-and-web

Monorepo sharing React Native UI (NativeWind + react-native-web / Expo) between a Next.js web app and an Expo app, backed by a Rust + Axum + sqlx API on PostgreSQL.

| Package | What | Port |
| --- | --- | --- |
| `components-library` | Shared UI: `src/common/` primitives, `src/business/` screens | Storybook `:6006` |
| `web-application` | Next.js 16 App Router, ISR-first hybrid | `:3000` |
| `mobile-application` | Expo SDK 57, Expo Router | Expo Go QR |
| `api-rs` | Sole API (Rust-only schema/migrations/queries) | `:3001` |

## 1. Requirements & install

- Node ≥ 20.19 / 22.12 (`fnm use`), pnpm 12.10.1, Rust stable (1.99.0 via rustup), Docker runtime (Colima ok: `brew install colima docker && colima start`), Xcode license accepted on macOS (`sudo xcodebuild -license accept`).
- Optional: `cargo-llvm-cov` (coverage), `k6` (load tests), `critcmp` (bench diffs).

```bash
pnpm install
docker compose up -d                      # Postgres + Valkey + Prometheus + Grafana
cp api-rs/.env.example api-rs/.env
pnpm --filter @rnw/api-rs db:migrate
pnpm --filter @rnw/api-rs db:seed         # demo seller only, no products (deliberate)
pnpm dev                                  # all four dev servers (Turborepo)
```

Open: web http://localhost:3000 · API http://localhost:3001 (`/health`, `/metrics`) · Storybook http://localhost:6006 · Grafana http://localhost:3002 (admin/rnw). Mobile: `pnpm --filter @rnw/mobile-application start` → scan QR with Expo Go.

> `db:seed-fixtures` / `db:clear-fixtures` are for Playwright/Detox only (provide `prod-1`). Never fold fixtures into `db:seed`.

## 2. Commands

Run from root. Prefix per package: `pnpm --filter <pkg> <script>`.

**Root** (`pnpm <script>`): `dev` · `build` · `lint` · `typecheck` · `test` (unit, no Docker) · `test:e2e:web` · `test:e2e:mobile` · `format` / `format:check` (Biome).

**components-library** (`@rnw/components-library`): `dev` / `storybook` (dev, :6006) · `build-storybook` · `test` (`vitest run`) · `test:watch` · `lint` (`biome lint .`) · `typecheck`.

**web-application** (`@rnw/web-application`): `dev` (`next dev`) · `build` · `start` · `test` · `test:watch` · `test:e2e` (Playwright) · `lint` · `typecheck`.

**mobile-application** (`@rnw/mobile-application`): `dev` / `start` (`expo start`) · `android` · `ios` · `web` (`expo start --<platform>`) · `prebuild` (required once before Detox; generates gitignored `ios/`/`android/`) · `test:e2e:build` (`detox build`) · `test:e2e` (`detox test`; Jest runner, needs built app — Expo Go insufficient) · `lint` · `typecheck`. No Vitest here. Bundle check without simulator: `expo export --platform ios`.

**api-rs** (`@rnw/api-rs`): `dev` (`scripts/dev.sh`, :3001) · `build` · `start` · `lint` (`fmt --check` + clippy `-D warnings`) · `typecheck` (`cargo check`) · `test` (unit, no Docker) · `test:e2e` (testcontainers, Docker) · `test:all` (both) · `coverage` (80% line gate, needs `cargo-llvm-cov`) · `bench` · `db:migrate` · `db:seed` · `db:seed-fixtures` · `db:clear-fixtures` · `test:e2e:update-goldens` (`UPDATE_GOLDENS=1 … parity --ignored`). Load tests have no script: `k6 run load-tests/k6/<scenario>.js`. Details: [`api-rs/README.md`](api-rs/README.md), [`load-tests/README.md`](load-tests/README.md).

**Useful one-liners:** `pnpm turbo run lint typecheck test build` (all, cached) · `pnpm turbo run build --dry-run` (graph).

## 3. Web rendering & SEO

ISR-first hybrid. Shared screens are `"use client"` (NativeWind has no RSC support); each catalogue route is a thin Server Component fetching data, delegating to a small client view:

| Route | Rendering |
| --- | --- |
| `/` | ISR 60s: the home page is the marketplace list — server fetches page 1, `useInfiniteProducts` from page 2 |
| `/product/[id]`, `/stores/[id]` | ISR 300s + on-demand (`generateStaticParams: []`; `next build` never needs API; unreachable API → per-request fallback) |
| `/login`, `/cart`, `/checkout`, `/wishlist`, `/my-store/**` | CSR (private; `robots.txt` disallows `/my-store`) |
| `/sitemap.xml`, `/robots.txt` | Static (sitemap from catalogue page 1) |

Single transport: `lib/api-server.ts` reuses `createApi` with Next cache directives via `fetchImpl`; reads tagged (`lib/catalogue.ts`), seller writes call `revalidateCatalogue` (`app/actions.ts`).

SEO rules (see `AGENTS.md`): cards use `<Link>` on web (`ProductCard.web.tsx`) / `Pressable` native — never merge; detail pages wrap in `<article>` + `<h1>` (`ProductDetailScreenWithSemantics`) + JSON-LD `Product/Offer` (sync new `ProductData` fields); every public page sets `canonical`, OG (`url`, `site_name`), Twitter cards; images need explicit `width`/`height` + `accessibilityLabel`; new public routes go in `sitemap.ts` (products: weekly/0.8). Never `noindex` catalogue pages.

## 4. Gotchas (read before "fixing")

- **Client boundaries:** every subtree rendering shared UI sits behind `"use client"` (`app/page.tsx`, `providers.tsx`, `ssr-styles-wrapper.tsx`). Still SSR HTML, just not RSC-streamed.
- **Nav:** Expo Router + Next App Router, unified only at `MainNav` via Solito. Native `MainNav.tsx` must never import Solito (its `useLinkTo` targets bare React Navigation, absent under Expo Router's vendored fork → throws); `MainNav.web.tsx` alone uses `solito/navigation`. Both are thin adapters over `MainNavItem.tsx`; both `forwardRef` (for `TabTrigger asChild`). Same pattern for `Product` (shared body + image-element adapters). Split the file, not the component — unless rendering strategy differs (`FlatList` vs CSS grid stays split).
- **Expo `<TabList>`** only discovers direct `<TabTrigger>` children — mobile `_layout.tsx` builds the bar flat from `<TabList>`, reusing `BOTTOM_NAV_*`/`nativeOverlayStyle` exports. `expo-router/ui` `Slot` throws on array `style`; non-`asChild` used deliberately.
- **Stubs/mocks:** `safe-area-context` is stubbed for Vite/webpack web (`components-library/stubs/`); `cssInterop` is mocked as identity in Vitest (real builds untouched); Storybook sets esbuild JSX loader for `react-native-css-interop/dist/doctor.js`. `IconBase` registers via `cssInterop` so `className` color → native `stroke`.
- **Styling system:** dark mode via CSS vars (`tokens.css`, single owner; `darkMode: "class"`; web toggles `.light`/`.dark`, native follows OS) — no `dark:` classes. Neutral ramp is an elevation ladder; `border` (actions, 3.43:1) ≠ `border-muted` (fields) ≠ `surface-muted` (decorative). Pinned by `tokens.parity.test.ts`.
- **`Button` is the only button** (`primary`/`secondary`, no sizes; new variant/size needs `improve-proposals/` + team sign-off). One `h-control` height (44px) shared with `Input`; required kebab-case screen-scoped `testId` (never derived from label); toggle buttons also pass `selected`. Allowlisted non-Buttons (`MainNav` items, `Product` card, `Drawer` catcher, `IconsGallery` preview) pinned by `Button.centralization.test.ts`. Details: `.agents/rules/`.
- **Text color:** no `text-current` (no-op natively); use `Pressable`'s `pressed` render-prop to pick `text-muted`/`text-brand`.
- **Cache invalidation:** list keys (`products:list:<gen>:…`) can't be enumerated — writes `INCR` the generation then `invalidate_detail(id)` ordering is detail-first; generation cached in-process (bounded staleness; see `api-rs/ARCHITECTURE.md` §12).
- **Sessions:** shared `createPersistStorage` (localStorage web / in-memory native) fits cart, not tokens — proper fix is `expo-secure-store` (needs dev build) + `httpOnly` cookie on web (see `useSessionStore.ts`).
- **`BottomNav`** floats via `nativeOverlayStyle` (`position: absolute` native-only; `fixed` is web-only) with a transparent gap — content scrolls underneath on both platforms.
- **DB ownership:** `api-rs/migrations/` + sqlx embedded migrator is the only toolchain (rebuild needed after adding one via `build.rs`); container ships `api-rs` binary only. pnpm `node-linker=hoisted` required for Metro; `react`/`react-dom`/`react-native` pinned identical via catalog to avoid duplicate React.
- **Tests:** components-library tests run jsdom + react-native-web (`vitest.config.web.ts`, `jsxImportSource: react`), asserting behavior not class output (class fidelity via Storybook/Playwright). Native halves of splits covered by `tsc` + Detox.

## 5. Commits, perf, monitoring

- Conventional Commits enforced by commitlint/husky (`type(scope): description`).
- k6 scenarios + SLOs: [`load-tests/README.md`](load-tests/README.md). Prometheus scrapes api-rs at `host.docker.internal:3001`; CDN setup: [`monitoring/cloudflare.md`](monitoring/cloudflare.md) (headers alone don't cache API JSON).
