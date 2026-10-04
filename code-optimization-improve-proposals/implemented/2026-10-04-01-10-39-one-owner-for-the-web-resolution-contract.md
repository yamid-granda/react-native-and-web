# One owner for the web resolution contract, so `react-native-svg` stops being two modules

## Problem / opportunity

Every web-facing tool in this repo has to answer the same two questions before it
can load a file: *what does `react-native` mean*, and *when both `X.tsx` and
`X.web.tsx` exist, which one wins*. Four tools answer them —
`components-library/vitest.config.web.ts`, `web-application/vitest.config.ts`,
`components-library/.storybook/main.ts`, and `web-application/next.config.ts` —
and they do not give the same answer.

### 1. The platform-resolution order is written out five times, and two sites admit they are mirrors

| # | file:line | entries | notes |
| --- | --- | --- | --- |
| 1 | `components-library/vitest.config.web.ts:26-37` | 10 | `.web.js` first |
| 2 | `web-application/vitest.config.ts:26-37` | 10 | byte-identical to #1 |
| 3 | `components-library/.storybook/main.ts:28-39` | 10 | byte-identical entries |
| 4 | `components-library/.storybook/main.ts:51-62` | 10 | byte-identical entries; **the comment at `:40-47` says why it is duplicated** |
| 5 | `web-application/next.config.ts:37-48` | 10 | **`.web.jsx` instead of `.mts`, different order** |

Plus a sixth, in the webpack branch (`next.config.ts:57-63`), which prepends
`[".web.tsx", ".web.ts", ".web.jsx", ".web.js"]` to Next's own defaults — again
`.web.jsx`, no `.mts`, and appended rather than replaced. Its comment at `:33`
opens *"Mirrors the webpack `resolve.extensions` below"* and it does not.

Two of these comments state the invariant in prose and nothing enforces it:

```
// components-library/.storybook/main.ts:40-44
// esbuild's dep-optimizer bundles react-native-svg with its own
// separate resolveExtensions (doesn't inherit the .web.js-first list
// above), so its internal extension-less relative imports (e.g.
// "./elements") resolve to the native, fabric/codegen-importing
// files instead of the *.web.js ones. Mirror the list here too;
```

```
// web-application/next.config.ts:33
// Mirrors the webpack `resolve.extensions` below, for project files that
// ship their own `.web.*` variant.
```

**This half of the finding is latent, and I will not claim otherwise.** The repo
has three platform-split files (`ProductListScreen.web.tsx`, `MainNav.web.tsx`,
`Product.web.tsx`), no `.mts` file and no `.web.jsx` file anywhere, and all five
lists put `.web.tsx` ahead of `.tsx`. So list #5 has never produced a wrong
answer. It is duplication that costs an edit in five places the next time the
question changes, and nothing more.

### 2. `react-native-svg` resolves to two different modules, and only the smaller one is ever built

This half is not latent.

```ts
// web-application/next.config.ts:11
const reactNativeSvgStubPath = "../components-library/stubs/react-native-svg.js"
// :29, inside turbopack.resolveAlias
"react-native-svg": reactNativeSvgStubPath,
```

```ts
// components-library/vitest.config.web.ts:14
// web-application/vitest.config.ts:13
// components-library/.storybook/main.ts:26
"react-native-svg": "react-native-svg/lib/module/ReactNativeSVG.web.js",
```

The stub is two lines of re-export
(`components-library/stubs/react-native-svg.js:15-16`) and nothing else:

```js
export * from "react-native-svg/lib/module/elements.web.js"
export { default } from "react-native-svg/lib/module/elements.web.js"
```

`elements.web.js` exports 43 shape classes plus a default. The module the other
three tools use, `ReactNativeSVG.web.js`, exports all of those **plus 16 named
runtime exports**:

```
LocalSvg  SvgAst  SvgCss  SvgCssUri  SvgFromUri  SvgFromXml  SvgUri
SvgWithCss  SvgWithCssUri  SvgXml  WithLocalSvg  camelCase  fetchText
inlineStyles  loadLocalRawResource  parse
```

(Reproduce with step 6 in **Validation**.) So `react-native-svg` is the full
module under Vitest and Storybook, and a 44-export subset of it in the Next.js
build.

### 3. No check in the repo can see the difference

- **`tsc` cannot.** `components-library/tsconfig.json` and
  `tsconfig.base.json` declare no `paths`, so `import { SvgCss } from
  "react-native-svg"` resolves to the package's own types and describes the full
  module. The stub is a bundler-level `resolveAlias`, not a type-level mapping,
  so the type system has no way to know it is in effect.
- **The 46 unit-test files cannot.** Both Vitest configs alias to the real web
  entry (`vitest.config.web.ts:14`, `web-application/vitest.config.ts:13`), so
  every test — 31 `.web.test.tsx` files in `components-library/src`, 8 `.test.ts`
  files, and all 7 files in `web-application/tests/` — resolves the *full*
  module.
- **`build-storybook` cannot.** `.storybook/main.ts:26` is the real entry again.
- **`turbo run test` never reaches Playwright.** `turbo.json:47-50` defines `test`
  as its own task; `test:e2e` is separate at `turbo.json:51-54`. The one check
  that exercises the configuration where the stub is in effect is a Playwright
  run against a live Next build with api-rs up and seeded.

Today this is harmless by luck: all eleven `react-native-svg` imports under
`components-library/src` use only `Circle`, `Path`, `Line`, the default export,
and the type-only `SvgProps` — `SearchIcon.tsx:1`, `SunIcon.tsx:1`,
`CartIcon.tsx:1`, `CloseIcon.tsx:1`, `HomeIcon.tsx:1`, `HeartIcon.tsx:1`,
`MarketplaceIcon.tsx:1`, `IconBase.tsx:3`, `types.ts:1`, plus
`IconBase.web.test.tsx:3`. Every one of those is in the stub's surface. One icon
that reaches for anything else turns a passing build into a render-time failure
in the web app with green lint, green typecheck, green unit tests and a green
Storybook behind it.

### 4. The stub documents its own constraint accurately, and then stops

`stubs/react-native-svg.js:1-14` is a good explanation — I checked the claim it
makes about `xmlTags` and it holds: the web entry imports `./xml`, and
`node_modules/react-native-svg/lib/module/xml.js:5` is
`import { tags } from './xmlTags'`, so the unresolvable `./elements` import is
reached transitively exactly as the comment says. The problem is that lines
11-14 record the omission as a remark in a file nobody reads when adding an
icon, rather than as something that fails. The boundary between "exports the web
app happens to use" and "exports `components-library` may use" is real, load
bearing, and unenforced.

That boundary is also the expensive kind of knowledge for an agent. To answer
"can I use `react-native-svg`'s `SvgCss` in a shared icon?", the reader has to
find `next.config.ts`, follow it to `stubs/react-native-svg.js`, read the comment,
then go read the package's web entry to work out what else is missing — across
two packages, with no test and no type to stop them guessing.

## Proposed approach

Keep the stub, keep all four resolution sites where they are, keep the extension
lists byte-for-byte as they are today. Change two things: who owns the lists, and
whether the stub's reduced surface is enforceable.

### 1. New `components-library/web-resolution.ts` — the single owner

One dependency-free module. It must stay importable from `next.config.ts` and
`.storybook/main.ts` without dragging `react-native-web` into a bundler config's
module graph, so it holds **strings and arrays only** — no component imports, no
`components-library/src` import.

```ts
/**
 * The web resolution contract, owned once.
 *
 * Every web bundler and web test runner in this repo resolves `react-native` to
 * `react-native-web` and prefers a `.web.*` sibling over its bare counterpart.
 * If a component gains a platform split, this list is what decides which copy a
 * given tool loads — so it is defined here rather than restated per config.
 */

/** Vite / esbuild order. `.web.js` first, because react-native-svg's web build
 *  reaches its DOM shapes through an extensionless `from './elements'`. */
export const WEB_RESOLVE_EXTENSIONS = [
  ".web.js", ".web.ts", ".web.tsx",
  ".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json",
] as const

/**
 * Turbopack's order. It applies `resolveExtensions` to project files only, not
 * to files inside `node_modules` — which is why `react-native-svg` needs the
 * stub alias below at all.
 */
export const TURBOPACK_RESOLVE_EXTENSIONS = [/* … */] as const

/** The alias every web context needs. The two paths are parameters because the
 *  stub is reached from two different package roots. */
export function webResolveAlias(stubs: {
  safeAreaContext: string
  svg: string
}) {
  return {
    "react-native": "react-native-web",
    "react-native-safe-area-context": stubs.safeAreaContext,
    "react-native-svg": stubs.svg,
  } as const
}
```

`TURBOPACK_RESOLVE_EXTENSIONS` is the one open decision, and it should be made
explicitly rather than by accident:

- **Preferred:** export `WEB_RESOLVE_EXTENSIONS` for Turbopack too and delete the
  fifth list. Nothing in the repo needs `.mts` or `.web.jsx`.
- **If Turbopack rejects entries it does not know**, keep the second constant and
  put the reason in its doc comment — one comment in one file, instead of a
  silent difference between two arrays that are otherwise identical.

Either way the answer is in one place and the reason is written down. The webpack
branch (`next.config.ts:57-63`) keeps its own prepend, because merging with
Next's defaults is genuinely different from replacing them; give it a comment
saying so rather than leaving `:33`'s "Mirrors the webpack …" claim attached to a
list that does not mirror anything.

### 2. Point the four sites at it

- `components-library/vitest.config.web.ts:26-37` → `WEB_RESOLVE_EXTENSIONS`
- `web-application/vitest.config.ts:26-37` → `WEB_RESOLVE_EXTENSIONS`
- `components-library/.storybook/main.ts:28-39` → `WEB_RESOLVE_EXTENSIONS`
- `components-library/.storybook/main.ts:51-62` → `WEB_RESOLVE_EXTENSIONS`, which
  deletes the 7-line mirror comment at `:40-47`'s *raison d'être* along with it
  (keep the two sentences about `react-native-svg` needing to stay in the
  optimizer, which are still load bearing)
- `web-application/next.config.ts:37-48` → `TURBOPACK_RESOLVE_EXTENSIONS`
- All four alias maps → `webResolveAlias({ safeAreaContext, svg })`, keeping each
  site's own two path constants. `.storybook/main.ts:15-27` additionally spreads
  `viteConfig.resolve.alias` first; that stays.

The `.storybook` change is inside `tsconfig.json`'s `include`
(`["src", "*.ts", "*.tsx", ".storybook"]`), so it is typechecked.

### 3. Make the stub's reduced surface enforceable — this is the actual point

New `components-library/src/icons/svgWebEntryParity.web.test.tsx`:

```ts
import * as stub from "../../stubs/react-native-svg.js"
import * as web from "react-native-svg/lib/module/ReactNativeSVG.web.js"

/** Deliberate omissions, each with the reason. Today: all 16, per
 *  `stubs/react-native-svg.js:11-14` — the XML/CSS helpers reach
 *  `xmlTags.js`, which has the same unresolvable `./elements` import. */
const OMITTED = new Set([/* …16 names… */])

it("never exports something the real web entry does not", () => { /* subset */ })
it("exports every runtime export of the real web entry, or omits it on the record", () => { /* … */ })
```

**It must be `.web.test.tsx`, under `src/`, and that is not arbitrary.** The
`utils` project (`vitest.config.utils.ts:5-12`) declares no `resolve` key at
all, so Vite's default extension order applies and the web entry's
`import ... from './elements'` would resolve to the native Flow-typed
`elements.js` and fail to parse. Only the `web` project
(`vitest.config.web.ts:26-37`) makes `elements.web.js` win. The filename is what
selects the project (`vitest.config.web.ts:44` globs `src/**/*.web.test.tsx`,
`vitest.config.utils.ts:10` globs `src/**/*.test.ts`), and putting the file under
`src/` is what makes it reachable at all — the stubs directory is outside both
globs. `src/icons/` is the right home because the icon layer is the only thing
in the library that consumes `react-native-svg`.

This is the same shape as `Button.centralization.test.ts` — a cross-cutting
invariant, one test, allowed to read the filesystem and keep an allowlist with a
reason per entry (`:15-24`, and `:63-70` proves no entry goes stale). The repo
already has the precedent and the discipline.

Run this test **before** touching any config. If `elements.web.js` does not load
under jsdom, the parity test's premise is wrong and that is worth knowing first.

## Impact

**Consistency.** Four byte-identical 10-entry arrays stop being maintained four
times, and the fifth stops being a silent variant of them. The two comments that
currently assert a mirror relationship in prose (`main.ts:40-44`,
`next.config.ts:33`) become true by construction or get corrected.

**Testability.** This is the real gain. A partial `react-native-svg` becomes a
`pnpm --filter @rnw/components-library test` failure rather than something only a
Playwright run against a seeded api-rs can observe. The hole moves from
"invisible to lint, typecheck, 46 unit tests and the Storybook build" to
"one assertion away."

**Reuse.** One owner for the resolution contract, and one place to look for
"which exports of `react-native-svg` may I use" instead of three files across two
packages.

**Performance.** None, and none is claimed. No runtime module changes, no import
graph changes, no bundle-size change. This is a refactor plus one test.

**What does not improve.** The stub stays partial — the parity test *records* the
16 omissions rather than fixing them, and `stubs/react-native-svg.js:11-14` is
still the reason they exist. Metro's native resolution is a different mechanism
entirely and is untouched. The three platform-split components are untouched; the
extension lists do not gain or lose an entry that changes which one any tool
loads today. And this does not close the separate, larger gap that
`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
and its siblings identify about duplicated test harnesses — the two Vitest
*setup* files (`vitest.setup.web.ts` / `vitest.setup.ts`, six of seven lines
identical) are the same shape of problem in miniature and are deliberately left
alone here.

## Risks / trade-offs

- **This touches `next.config.ts`, which is the riskiest file in the repo to
  touch.** If `web-resolution.ts` accidentally imports anything from
  `components-library/src`, the Next config's module graph pulls in
  `react-native-web` and the build breaks in a confusing way. That is why the
  module is specified as strings and arrays only. Land the extraction and the
  parity test first, `next.config.ts` last.
- **It touches a documented decision, and the diff has to make that clear.**
  `next.config.ts:5-11` and `stubs/react-native-svg.js:1-14` both explain *why*
  the stub exists: Turbopack's `resolveExtensions` does not apply inside
  `node_modules`, so the web entry's extensionless `./elements` import resolves to
  the native file. **This proposal keeps the stub.** It adds enforcement to a
  constraint that is already correct, and it does not try to remove the reason. If
  a reviewer reads "delete the stub", the proposal dies on framing.
- **Unifying the Turbopack extension list is a behaviour change to the web
  app's resolution.** Keep it in its own commit, after the parity test lands, so
  it can be reverted independently if a build disagrees.
- **The parity test needs an allowlist with 16 entries on day one**, which looks
  like a test that ships pre-broken. It is the opposite: an allowlist is a
  decision on the record that someone chose, and every entry has to name why. The
  alternative today is a silent gap nobody chose.
- **A reviewer may reasonably prefer to grow the stub instead of enumerating the
  gap** — aliasing `react-native-svg/xml` and `react-native-svg/deprecated`
  separately would likely close most of the 16 and shrink the allowlist towards
  zero. That is plausibly the better end state and needs someone who can run
  `pnpm --filter @rnw/web-application build` to try it. Either way the parity
  test is the thing that makes the difference visible, so land it first and let it
  tell you how much is left.
- **`web-application` importing a relative path out of `components-library` is
  already the pattern** (`next.config.ts:9`, `:11`, `:18`) so this introduces no
  new coupling — but it does mean `components-library` gains a file that is not a
  component and not exported from `src/index.ts`. That is correct (importing it
  through the barrel would pull the RN module graph into a bundler config) and
  worth a line in the new file's doc comment.
- **Scope.** The duplicated per-file test harness — the router mock in 9 files,
  `QueryClient` in 4, the product fixture in 6 — and the three persisted-store
  tests (`useCartStore.test.ts`, `useWishlistStore.test.ts`,
  `useRecentlyViewedStore.test.ts`) that run in the node-only `utils` project
  against `persistStorage.ts`'s in-memory branch while
  `useSessionStore.web.test.tsx:9-11` documents why they must not, are all real
  and all separate. None of them belong here.

## Validation

1. `pnpm --filter @rnw/components-library test`, **before any config changes.**
   This is the gate on the premise: the existing 39 files must pass unchanged, and
   the new parity suite must be green. If `elements.web.js` will not load under
   jsdom, stop here.
2. `pnpm --filter @rnw/components-library test` again after steps 1-2 of the
   approach: 40 files, still green, with no existing assertion edited.
3. Negative check for the parity suite, in a scratch branch: add
   `export const SvgAst = undefined` to `stubs/react-native-svg.js` and confirm
   the suite fails. If it passes, the test is not asserting anything.
4. `pnpm --filter @rnw/web-application test` — 7 files, must pass **unchanged**.
   This is the gate that the shared alias map did not alter what
   `web-application`'s jsdom project resolves.
5. `pnpm typecheck && pnpm lint`. `components-library/tsconfig.json` `include`s
   `.storybook`, so the new import in `main.ts` is typechecked; Biome will flag
   the new module if it is not formatted like the rest of the tree.
6. `pnpm --filter @rnw/components-library build-storybook`. This is the check
   that the Storybook refactor is inert: both `main.ts` lists now come from one
   import, and the `optimizeDeps.esbuildOptions.resolveExtensions` mirror is still
   required (`:40-47`) even though it is no longer a copy.
7. Reproduce the 16-export divergence this proposal is about, before and after:
   ```bash
   node -e 'import("react-native-svg/lib/module/ReactNativeSVG.web.js")' 2>/dev/null \
     || node --input-type=module -e '
       const web = await import("react-native-svg/lib/module/ReactNativeSVG.web.js")
       const stub = await import("./components-library/stubs/react-native-svg.js")
       const missing = Object.keys(web).filter((k) => !(k in stub))
       console.log(missing.length, missing.join(" "))'
   ```
   Before: `16 LocalSvg SvgAst SvgCss …`. After step 3 of the approach, the
   number is asserted rather than printed.
8. `pnpm --filter @rnw/web-application build` — **the only check that exercises
   `next.config.ts`'s `turbopack.resolveExtensions` and the stub at all.** This is
   the reason the Turbopack change is its own commit. (Not run during this
   analysis run; it belongs to whoever implements it.)
9. `pnpm --filter @rnw/web-application test:e2e` — needs api-rs running and
   seeded. Every spec renders the nav bar, so this is the end-to-end confirmation
   that icon resolution is unchanged in a real Next build.
10. Mechanical check, the same shape as the table at the top:
    ```bash
    grep -rn 'resolveExtensions\|resolve\.extensions' --include='*.ts' \
      components-library web-application | grep -v node_modules
    ```
    Success is not "zero hits" — it is that every hit is either an import of
    `web-resolution.ts`, the webpack prepend that merges with Next's defaults, or
    the webpack branch's own comment.
11. Not required, and honestly so: nothing here touches `api-rs` or
    `mobile-application`. No Rust check applies, and Metro's native platform
    resolution is a separate mechanism this proposal does not change.

## Related proposals

- **`code-optimization-improve-proposals/2026-10-03-23-50-00-one-body-behind-the-platform-splits.md`
  — related, not superseded, and it is why this one is small.** Its scope note
  names "the `vitest.config.ts` / `vitest.config.web.ts` pair in
  `components-library` and its near-clone in `web-application/vitest.config.ts`" as
  a separate duplication and says "None of them belong here." That is a deferral,
  not a proposal, and this document is materially more than that pair: it
  analyses the resolution *lists*, the alias maps, the `react-native-svg` stub and
  the parity hole, none of which that proposal touches. The two also ask
  different questions about the same area. That proposal asks *"should `Product`
  and `MainNav` be two files?"* and concludes no; this one asks *"who owns the
  list that decides which of the two a given tool loads?"* If that proposal lands
  first, this one gets smaller — `components-library` goes from three
  platform-split components to one — and the `resolve.extensions` unification
  gets easier to land with it.
- **`code-optimization-improve-proposals/2026-10-03-22-15-47-move-seller-route-wiring-into-components-library.md`
  — unrelated surface (per-app route files).** Its one overlap is
  `vitest.config.web.ts:26-37`, cited at its line 222 as evidence that a shared
  body would be reachable from the existing web project. This proposal moves no
  source file, so that argument is unaffected.
- **`code-optimization-improve-proposals/2026-10-03-22-34-46-one-read-path-for-the-product-lists.md`
  — unrelated surface (`api-rs` handlers and cache).** No overlap.
- **`code-optimization-improve-proposals/2026-10-03-22-37-46-make-the-store-contract-executable.md`
  — unrelated surface (`api-rs/src/store/`).** Its scope note lists several
  config-level and dead-code items; the web resolution contract is not one of
  them.
- **`improve-proposals/2026-10-03-seller-storefronts-my-store.md`** — the proposal
  that created the seller routes and settled the duplicated api clients. No
  overlap.