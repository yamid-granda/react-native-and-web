# Repository Guide

This is a pnpm/Turborepo monorepo for a Next.js web app and an Expo mobile app. Both apps share UI from `components-library`; `api-rs` is a Rust/Axum read API backed by PostgreSQL.

## Response style (all agents, every prompt)

> "You are a concise coding assistant. Provide only the direct answer, code snippet, or key figures. Avoid conversational filler, introductory text, and explanations unless explicitly asked."

- Minimize output tokens without dropping information: no preambles, no restating the request, no recaps of what was just done, no "Summary"/"Next steps" sections unless asked.
- Lead with the result (code, file path, command, number). Use short bullets; skip prose paragraphs.
- Keep required reports (checklist results, checks-run-and-skipped) but state them tersely.
- Explanation is withheld only when unasked, never when it is the answer.

## Workspaces

- `components-library/src/common/` — reusable UI components; `src/business/` — shared screens and state; `src/icons/` — icons.
- `web-application/` — Next.js App Router app and Playwright end-to-end tests. Read its `AGENTS.md` before changing web code.
- `mobile-application/src/app/` — Expo Router routes and layouts; keep non-route code outside `src/app/`. Read its `AGENTS.md` before changing mobile code.
- `api-rs/src/` — Axum router, handlers, cache tiers, and middleware; `api-rs/migrations/` — the schema (sqlx migrations); `api-rs/src/seed.rs` and `api-rs-db` — the demo seller (`db:seed`) and the e2e fixture products (`db:seed-fixtures`/`db:clear-fixtures`). api-rs is Rust-only and owns all of it; see its `README.md`.
- `improve-proposals/` — feature proposals and implemented proposal records.

## Visual manual (mandatory for all UI work)

`docs/system-design/index.md` is the UI standard for this repository. **Read it before writing, changing, or reviewing any UI** in `components-library/`, `web-application/`, `mobile-application/`, or any interface added later. It is binding and outranks intuition, existing code, and framework defaults: if a component disagrees with the manual, follow the manual and fix the component in the same change.

- It is the single place for color, typography, spacing, shape, elevation, motion, loading/empty/error states, control variants, the product card, marketplace conversion rules, and the phone/tablet/desktop layout ladder. Do not restate or re-derive those values in a component, a scoped `AGENTS.md`, or a Storybook decorator — read them from `components-library/tokens.css` and `tailwind-preset.cjs`.
- Shared view rule: phone, web-mobile, tablet, and desktop render the same shared components. Breakpoints add columns, containment, and rails in app wrappers and list screens only; they never fork component internals.
- No new color, type size, spacing value, radius, control variant, or elevation step without an agreed `improve-proposals/` entry first. Reach for the existing token before reaching for a local value.
- Adding a screen or component means: proposal → `tokens.css` → `tailwind-preset.cjs` → `components-library` → Storybook story → test → both apps.
- The automated guards are `components-library/src/tokens.parity.test.ts` (palette, contrast floors, literal allowlist) and `components-library/src/common/Button/Button.centralization.test.ts` (single button). A change that trips either is not done.
- Verify the §12 checklist in the manual before reporting UI work complete.

## Mobile-first + desktop (mandatory for all UI work)

- Build phone first (verify at 320px and 360px), then enhance upward. Tablet/desktop only add columns, containment, and rails — they never fork component internals.
- Desktop styles live only in `web-application/app/**` wrappers and `components-library/*.web.tsx` list-screen splits. Never add `md:`/`lg:`/`xl:` to a shared `*.tsx` component, and never add breakpoint classes, desktop imports, or desktop-only components to `mobile-application/`.
- Web shell rule: `BottomNav` is phone/tablet only (`lg:hidden`); `DesktopHeader` is desktop only (`hidden lg:flex`). Exactly one nav is visible per viewport.
- Catalogue ladder: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`; filters rail `lg:w-60 lg:sticky lg:top-20`. Containment `max-w-3xl lg:max-w-6xl xl:max-w-7xl` lives once in `web-application/app/layout.tsx`.
- Verify with `grep -r "lg:\|xl:" mobile-application/src components-library/src --include="*.tsx" | grep -v ".web.tsx"` returning only allowed hits, plus `tests/desktop.test.tsx` and `e2e/desktop.spec.ts`.

## Architecture and implementation

- Before changing cross-platform UI or app wiring, read the relevant section of `README.md`, especially **Architecture boundaries and known gotchas**. It records platform constraints that are easy to reintroduce accidentally.
- UI used by both apps belongs in `components-library` and should be imported by both. Keep platform routing and app-specific wiring in thin app wrappers; only split implementations when platform behavior genuinely requires it.
- Shared components use React Native primitives and NativeWind. Follow nearby component, test, and Storybook patterns rather than introducing a second styling or state approach.
- Keep route definitions in each app's existing router. Do not move app-specific routing into the shared library.
- Use pnpm (version pinned in the root `package.json`) and the existing workspace scripts. To change the database schema, add a reversible migration pair under `api-rs/migrations/` and run `api-rs`'s `db:migrate`/`db:seed` scripts — that is the only supported path, and adding a second migration toolchain is not.
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

### api-rs checks

| Kind | Command | Requires |
| --- | --- | --- |
| Unit tests | `pnpm --filter @rnw/api-rs test` | — |
| Hermetic E2E + contract parity | `pnpm --filter @rnw/api-rs test:e2e` | Docker |
| All tests (unit + E2E) | `pnpm --filter @rnw/api-rs test:all` | Docker |
| Coverage gate (80% lines) | `pnpm --filter @rnw/api-rs coverage` | `cargo-llvm-cov` |
| Benchmarks | `pnpm --filter @rnw/api-rs bench` | — |
| Lint (fmt + clippy) | `pnpm --filter @rnw/api-rs lint` | — |
| Typecheck | `pnpm --filter @rnw/api-rs typecheck` | — |

`test:all` chains the two cargo suites; it is deliberately not named `test`, so
`turbo run test` stays free of the Docker-dependent E2E run. Load tests are not
a `pnpm` script — run them by hand with `k6 run load-tests/k6/<scenario>.js` (see
`load-tests/README.md`).

Run the narrowest relevant checks for a change, then broader checks when practical. Report checks that could not run and why (for example, missing PostgreSQL or a mobile simulator). See `README.md` for service setup, Storybook, and native build details.

## Working conventions

- Make the smallest change that fits the existing architecture. Add or update tests alongside behavior changes and follow the nearest tests' conventions.
- Prefer clear names and simple code. Add comments only for non-obvious constraints or decisions; put repo-wide explanations in `README.md`.
- Use Conventional Commits for commit messages. Never commit or push unless explicitly asked; do not perform destructive git operations without explicit approval.
- Keep shared UI in `components-library`; read `.agents/rules/component-reuse.md` before changing cross-platform UI.
- `Button` has exactly two variants (`primary`, `secondary`) and no size variants. Use one of them; a new variant or a new size needs a proposal under `improve-proposals/` agreed with the team before implementation. See `.agents/rules/button-variants.md`.
- See `.agents/rules/` for the full project policies. Before using a task workflow, read its matching skill in `.agents/skills/`; reusable role prompts are in `.agents/agents/`.

## SEO policy (web application)

The public catalogue routes (`/marketplace`, `/marketplace/[id]`, `/stores/[id]`) are server-rendered for SEO. When changing components or pages that affect these routes, follow these rules:

### Crawlable links

- **Product cards must use `<Link>` on web**, not `Pressable` + `router.push()`. Crawlers discover pages by following `<a href>` tags; a `Pressable` renders as a `<div>` and is invisible to them.
- The platform split already handles this: `ProductCard.web.tsx` wraps the card in a Next.js `<Link>`, while `ProductCard.tsx` (native) uses `Pressable`. Do not "simplify" this back into a shared `Pressable`.
- Any new clickable card or list item that navigates to a public route must follow the same pattern: `.web.tsx` uses `<Link>`, native uses `Pressable`.

### Semantic HTML

- **Product detail pages must use semantic HTML.** The web wrapper `ProductDetailScreenWithSemantics` wraps the screen in `<article>` and renders the product title as `<h1>`. Do not remove these wrappers.
- Use `<article>` for self-contained product/store content, `<h1>` for the product/store name, and `<section>` for logical groupings.
- The shared `ProductDetailScreen` renders `<Text>` (a `<span>` on web) for the title; the `.web.tsx` wrapper adds the `<h1>`. This split is intentional.

### Structured data (JSON-LD)

- **Product and store pages must include JSON-LD structured data.** The product detail page (`app/marketplace/[id]/page.tsx`) already emits a `Product` schema with `offers` (price, currency, availability). Keep it in sync with the `ProductData` type.
- If you add new fields to `ProductData` that are SEO-relevant (e.g., `brand`, `sku`, `rating`), add them to the JSON-LD.
- Use `https://schema.org` types. For products: `Product` + `Offer`. For stores: `Store` + `Place`.

### Metadata

- **Every public page must set `alternates.canonical`** in `generateMetadata`. This prevents duplicate-content issues if the same page is reachable via multiple URLs.
- **Every public page must set OpenGraph `url` and `site_name`** in addition to `title`, `description`, and `images`.
- **Every public page should set Twitter Card metadata** (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`) for social sharing.
- The root layout's `metadataBase` and `title.template` are already configured; page-level metadata overrides them.

### Images

- **Product images must have explicit `width` and `height`** to prevent Cumulative Layout Shift (CLS). The web adapter (`Product.web.tsx`) sets `width={300}` and `height={128}` (matching `h-32`). If you change the CSS height, update the `height` prop to match.
- Always set `accessibilityLabel` (maps to `alt` on web) on product images.

### Sitemap

- The sitemap (`app/sitemap.ts`) lists product pages from the first catalogue page. If you add new public routes, add them to the sitemap.
- Product pages use `changeFrequency: "weekly"` and `priority: 0.8`. Keep these values unless there's a specific reason to change them.

### What NOT to do

- Do not add `noindex` to public catalogue pages.
- Do not remove the `generateMetadata` export from public pages.
- Do not replace `<Link>` with `Pressable` in web components.
- Do not remove JSON-LD structured data from product/store pages.
- Do not remove `width`/`height` from product images.
